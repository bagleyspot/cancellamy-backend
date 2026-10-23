import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { NuisanceReport, NuisanceReportDoc, RemovalRequest, RequestDoc } from '../db/schemas';
import { Clock, addDays } from '../common/clock';
import { CryptoService } from '../common/crypto.service';
import { conflict } from '../common/errors';
import { NotificationsService } from '../notifications/notifications.service';
import { PdfService } from '../pdf/pdf.service';
import { ProfileDataService } from '../profiles/profile-data.service';
import { fullName } from '../profiles/profile.types';
import { NuisanceEvent, nuisanceComplaintText } from '../templates/request-templates';
import { NuisanceReportDto } from './nuisance.dto';

const MAX_REPORTS_PER_USER = 500;
const RPO_EFFECT_DAYS = 15;
const GARANTE_SEGNALAZIONE_URL = 'https://www.garanteprivacy.it/home/diritti/come-agire-per-tutelare-i-tuoi-dati-personali';

interface Sensitive {
  callerNumber?: string;
  company?: string;
  summary?: string;
}

/** Same caller, different spelling: digits only, without the international prefix of Italy. */
export function normaliseNumber(value: string | null): string {
  let d = (value ?? '').replace(/\D/g, '');
  if (d.startsWith('0039')) d = d.slice(4);
  else if (d.startsWith('39') && d.length >= 11) d = d.slice(2);
  return d;
}

export interface NuisanceReportShape {
  id: string;
  profileId: string;
  channel: string;
  callerNumber: string | null;
  company: string | null;
  receivedAt: string;
  summary: string | null;
  consentGiven: 'no' | 'unknown';
  rpoActiveAtTime: boolean | null;
  createdAt: string;
}

@Injectable()
export class NuisanceService {
  constructor(
    @InjectModel(NuisanceReport.name) private readonly reports: Model<NuisanceReportDoc>,
    @InjectModel(RemovalRequest.name) private readonly requests: Model<RequestDoc>,
    private readonly data: ProfileDataService,
    private readonly crypto: CryptoService,
    private readonly pdf: PdfService,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async rpo(profileId: Types.ObjectId) {
    const r = await this.requests.findOne({ profileId, brokerCategory: 'opposition_register', kind: { $ne: 'access' }, status: 'completed' }).sort({ completedAt: -1 });
    if (!r || !r.completedAt) return { registered: false, requestId: null as string | null, completedAt: null as Date | null, effectiveFrom: null as Date | null };
    return { registered: true, requestId: String(r._id), completedAt: r.completedAt, effectiveFrom: addDays(r.completedAt, RPO_EFFECT_DAYS) };
  }

  private toShape(d: NuisanceReportDoc, effectiveFrom: Date | null): NuisanceReportShape {
    const s = this.crypto.decryptJson<Sensitive>(d.dataEnc);
    return {
      id: String(d._id),
      profileId: String(d.profileId),
      channel: d.channel,
      callerNumber: s.callerNumber ?? null,
      company: s.company ?? null,
      receivedAt: d.receivedAt.toISOString(),
      summary: s.summary ?? null,
      consentGiven: d.consentGiven,
      rpoActiveAtTime: effectiveFrom ? d.receivedAt >= effectiveFrom : null,
      createdAt: d.createdAt.toISOString(),
    };
  }

  async overview(userId: string, profileId: string) {
    const profile = await this.data.getOwned(userId, profileId);
    const rpo = await this.rpo(profile._id);
    const docs = await this.reports.find({ userId: new Types.ObjectId(userId), profileId: profile._id }).sort({ receivedAt: -1 });
    const reports = docs.map((d) => this.toShape(d, rpo.effectiveFrom));
    const groups = new Map<string, { callerNumber: string | null; company: string | null; count: number; lastAt: string }>();
    for (const r of reports) {
      const key = `${normaliseNumber(r.callerNumber) || '-'}|${(r.company ?? '').trim().toLowerCase()}`;
      const g = groups.get(key);
      if (g) {
        g.count += 1;
        if (r.receivedAt > g.lastAt) g.lastAt = r.receivedAt;
      } else {
        groups.set(key, { callerNumber: r.callerNumber, company: r.company, count: 1, lastAt: r.receivedAt });
      }
    }
    return {
      rpo: {
        registered: rpo.registered,
        requestId: rpo.requestId,
        completedAt: rpo.completedAt ? rpo.completedAt.toISOString() : null,
        effectiveFrom: rpo.effectiveFrom ? rpo.effectiveFrom.toISOString() : null,
      },
      reports,
      topCallers: [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)).slice(0, 10),
    };
  }

  async create(userId: string, dto: NuisanceReportDto): Promise<NuisanceReportShape> {
    const profile = await this.data.getOwned(userId, dto.profileId);
    const total = await this.reports.countDocuments({ userId: new Types.ObjectId(userId) });
    if (total >= MAX_REPORTS_PER_USER) throw conflict('Report limit reached', 'CUSTOM_LIMIT_REACHED');
    const sensitive: Sensitive = {
      ...(dto.callerNumber?.trim() ? { callerNumber: dto.callerNumber.trim() } : {}),
      ...(dto.company?.trim() ? { company: dto.company.trim() } : {}),
      ...(dto.summary?.trim() ? { summary: dto.summary.trim() } : {}),
    };
    const doc = await this.reports.create({
      userId: new Types.ObjectId(userId),
      profileId: profile._id,
      channel: dto.channel,
      receivedAt: new Date(dto.receivedAt),
      consentGiven: dto.consentGiven ?? 'unknown',
      dataEnc: this.crypto.encryptJson(sensitive),
    });
    const rpo = await this.rpo(profile._id);
    return this.toShape(doc, rpo.effectiveFrom);
  }

  async remove(userId: string, id: string): Promise<void> {
    const res = await this.reports.deleteOne({ _id: id, userId: new Types.ObjectId(userId) });
    if (!res.deletedCount) throw new NotFoundException('Report not found');
  }

  private async complaintText(userId: string, profileId: string, reportIds?: string[]): Promise<string> {
    const profile = await this.data.getOwned(userId, profileId);
    const rpo = await this.rpo(profile._id);
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId), profileId: profile._id };
    if (reportIds?.length) filter._id = { $in: reportIds.filter((i) => /^[a-f0-9]{24}$/i.test(i)).map((i) => new Types.ObjectId(i)) };
    const docs = await this.reports.find(filter).sort({ receivedAt: 1 });
    if (!docs.length) throw conflict('Record at least one unwanted contact first', 'INVALID_STATE');
    const events: NuisanceEvent[] = docs.map((d) => {
      const r = this.toShape(d, rpo.effectiveFrom);
      return { at: r.receivedAt, channel: r.channel, callerNumber: r.callerNumber, company: r.company, summary: r.summary, consentGiven: r.consentGiven, rpoActiveAtTime: r.rpoActiveAtTime };
    });
    return nuisanceComplaintText({
      pii: this.data.pii(profile),
      events,
      rpoRegisteredOn: rpo.completedAt ? rpo.completedAt.toISOString().slice(0, 10) : null,
      rpoEffectiveFrom: rpo.effectiveFrom ? rpo.effectiveFrom.toISOString().slice(0, 10) : null,
      operatorName: this.config.operatorName,
      generatedOn: this.clock.now().toISOString().slice(0, 10),
    });
  }

  async complaint(userId: string, profileId: string, reportIds?: string[]) {
    const text = await this.complaintText(userId, profileId, reportIds);
    return {
      text,
      generatedAt: this.clock.now().toISOString(),
      pdfUrl: `/api/v1/nuisance/complaint.pdf?profileId=${profileId}`,
      submitUrl: GARANTE_SEGNALAZIONE_URL,
      steps: [
        'Scarica il PDF, controlla l\'elenco dei contatti e completa luogo, data e firma.',
        'Allega le schermate del registro chiamate (o dei messaggi) e, se ce l\'hai, la ricevuta del Registro delle Opposizioni.',
        'Allega una copia del tuo documento di identità.',
        'Invia la segnalazione al Garante dal portale online oppure via PEC a protocollo@pec.gpdp.it (accetta solo messaggi da PEC).',
        'La segnalazione non richiede formalità particolari, ma il Garante non è tenuto a rispondere singolarmente: per una tutela formale valuta un reclamo.',
      ],
    };
  }

  async complaintPdf(userId: string, profileId: string): Promise<Buffer> {
    const profile = await this.data.getOwned(userId, profileId);
    return this.pdf.render({
      title: 'Segnalazione al Garante per la protezione dei dati personali',
      body: await this.complaintText(userId, profileId),
      meta: `Bozza generata da ${this.config.operatorName} per ${fullName(this.data.pii(profile))}`,
      footer: ["Documento redatto sulla base dei dati inseriti dall'utente: non e' un parere legale."],
    });
  }

  /** Scheduler: 15 days after the RPO registration, tell the user it is in force and how to report violations. */
  async notifyRpoFollowUps(limit: number): Promise<number> {
    const now = this.clock.now();
    const due = await this.requests
      .find({ brokerCategory: 'opposition_register', kind: { $ne: 'access' }, status: 'completed', completedAt: { $lte: addDays(now, -RPO_EFFECT_DAYS) }, followUpNotifiedAt: { $exists: false } })
      .limit(limit);
    let n = 0;
    for (const r of due) {
      const claimed = await this.requests.findOneAndUpdate({ _id: r._id, followUpNotifiedAt: { $exists: false } }, { $set: { followUpNotifiedAt: now } });
      if (!claimed) continue;
      await this.notifications.notify(r.userId, {
        type: 'system',
        title: 'Il Registro delle Opposizioni è ora efficace',
        body: `Sono passati ${RPO_EFFECT_DAYS} giorni dall'iscrizione: le telefonate commerciali senza il tuo consenso non sono più lecite. Se ne ricevi, registrale per preparare una segnalazione al Garante.`,
        requestId: r._id,
        appPath: '/app/telemarketing',
      });
      n += 1;
    }
    return n;
  }
}
