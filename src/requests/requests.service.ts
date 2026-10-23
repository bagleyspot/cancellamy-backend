import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AttachmentFile, AttachmentFileDoc, Message, MessageDoc, ProfileDoc, RemovalRequest, RequestDoc } from '../db/schemas';
import { addDays } from '../common/clock';
import { CryptoService } from '../common/crypto.service';
import { badRequest, conflict, forbidden } from '../common/errors';
import { IdentityService } from '../identity/identity.service';
import { Paginated, escapeRegex, pageParams } from '../common/pagination';
import { BrokerDtoShape, BrokersService, toBrokerDto } from '../brokers/brokers.service';
import { MailError } from '../mail/mail.types';
import { PdfService } from '../pdf/pdf.service';
import { ProfileDataService } from '../profiles/profile-data.service';
import { fullName } from '../profiles/profile.types';
import { complaintText, manualRequestText } from '../templates/request-templates';
import { AuthUser } from '../auth/auth.types';
import { NotificationsService } from '../notifications/notifications.service';
import { ChannelPlan, planChannel } from './channel-plan';
import { RequestEngine, newShortRef } from './request-engine';
import { ReplyLabel } from './reply-classifier';
import {
  GROUP_STATUSES,
  RequestCounts,
  RequestGroup,
  addToCounts,
  emptyCounts,
  groupOf,
} from './status';
import { AccessFindingsDto, CreateAccessRequestsDto, CustomRequestDto, ListRequestsQuery, OutcomeDto, SimulateReplyDto } from './requests.dto';

const GARANTE_RECLAMO_URL = 'https://www.garanteprivacy.it/diritti/come-agire-per-tutelare-i-tuoi-dati-personali/reclamo';
const GARANTE_PORTAL_URL = 'https://servizi.gpdp.it';
const SIMULABLE = ['sent', 'replied', 'overdue', 'escalated'];

const SIMULATED_TEXT: Record<SimulateReplyDto['kind'], string> = {
  completed:
    'Buongiorno,\nabbiamo provveduto alla cancellazione di tutti i dati personali che la riguardano dai nostri archivi e l\'abbiamo inserita nella nostra lista di soppressione.\nCordiali saluti,\nUfficio Privacy',
  refused:
    'Buongiorno,\nnon è possibile accogliere la richiesta di cancellazione: i dati sono trattati sulla base di un obbligo di legge e di un legittimo interesse.\nCordiali saluti,\nUfficio Privacy',
  id_required:
    'Buongiorno,\nper procedere dobbiamo verificare la sua identità: ci invii una copia del documento di identità in corso di validità.\nCordiali saluti,\nUfficio Privacy',
  unknown: 'Buongiorno,\nprendiamo in carico la sua comunicazione e le faremo sapere appena possibile.\nCordiali saluti',
};

const SIMULATED_ACCESS_TEXT: Record<SimulateReplyDto['kind'], string> = {
  ...SIMULATED_TEXT,
  completed:
    'Buongiorno,\nin allegato trovate la copia dei dati personali che la riguardano, con le informazioni richieste dall\'art. 15 GDPR.\nCordiali saluti,\nUfficio Privacy',
};

const ACTIVITY_TEXT: Record<string, string> = {
  created: 'Richiesta creata',
  sent: 'Richiesta inviata',
  reminder_sent: 'Sollecito inviato',
  reply_received: 'Risposta ricevuta',
  status_changed: 'Stato aggiornato',
  id_provided: 'Documento inviato',
  escalated: 'Reclamo al Garante preparato',
  renewed: 'Nuova verifica avviata',
  marked_done: 'Azione completata dall\'utente',
  note: 'Nota',
};

export interface ListItemShape {
  kind: 'erasure' | 'access';
  id: string;
  shortRef: string;
  profileId: string;
  broker: { id: string; name: string; website: string | null; category: string };
  channel: string;
  status: string;
  group: RequestGroup;
  actionReason: string | null;
  cycle: number;
  custom: boolean;
  dryRun: boolean;
  createdAt: string;
  sentAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  nextCheckAt: string | null;
  lastActivityAt: string;
}

const iso = (d?: Date | null) => (d ? d.toISOString() : null);

function toListItem(r: RequestDoc | (RemovalRequest & { _id: Types.ObjectId }), createdAt: Date): ListItemShape {
  return {
    kind: r.kind ?? 'erasure',
    id: String(r._id),
    shortRef: r.shortRef,
    profileId: String(r.profileId),
    broker: { id: r.brokerKey, name: r.brokerName, website: r.brokerWebsite ?? null, category: r.brokerCategory },
    channel: r.channel,
    status: r.status,
    group: groupOf(r.status),
    actionReason: r.actionReason ?? null,
    cycle: r.cycle,
    custom: !!r.custom,
    dryRun: !!r.dryRun,
    createdAt: createdAt.toISOString(),
    sentAt: iso(r.sentAt),
    dueAt: iso(r.dueAt),
    completedAt: iso(r.completedAt),
    nextCheckAt: iso(r.nextCheckAt),
    lastActivityAt: r.lastActivityAt.toISOString(),
  };
}

@Injectable()
export class RequestsService {
  constructor(
    @InjectModel(RemovalRequest.name) private readonly requests: Model<RequestDoc>,
    @InjectModel(Message.name) private readonly messages: Model<MessageDoc>,
    @InjectModel(AttachmentFile.name) private readonly files: Model<AttachmentFileDoc>,
    private readonly engine: RequestEngine,
    private readonly identity: IdentityService,
    private readonly brokers: BrokersService,
    private readonly data: ProfileDataService,
    private readonly crypto: CryptoService,
    private readonly pdf: PdfService,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------------ profile lifecycle hooks
  async createForProfile(profile: ProfileDoc): Promise<{ emailRequests: number; manualActions: number }> {
    const brokers = await this.brokers.sendableBrokers();
    const revived = await this.engine.reviveSuspended(profile._id);
    let emailRequests = revived.email;
    let manualActions = revived.manual;
    for (const b of brokers) {
      const plan = planChannel(b);
      if (!plan) continue;
      const doc = await this.engine.createRequest(profile, {
        brokerKey: b.slug,
        brokerName: b.name,
        brokerWebsite: b.website,
        brokerCategory: b.category,
        plan,
        cycle: 1,
      });
      if (!doc) continue;
      if (plan.channel === 'email') emailRequests += 1;
      else manualActions += 1;
    }
    return { emailRequests, manualActions };
  }

  cancelQueuedForProfile(profileId: Types.ObjectId): Promise<void> {
    return this.engine.cancelQueuedForProfile(profileId);
  }

  // ------------------------------------------------------------------ queries
  private async owned(userId: string, id: string): Promise<RequestDoc> {
    const r = await this.requests.findOne({ _id: id, userId: new Types.ObjectId(userId) });
    if (!r) throw new NotFoundException('Request not found');
    return r;
  }

  async list(userId: string, q: ListRequestsQuery): Promise<Paginated<ListItemShape>> {
    const filter: FilterQuery<RequestDoc> = { userId: new Types.ObjectId(userId) };
    if (q.profileId) filter.profileId = new Types.ObjectId(q.profileId);
    if (q.kind) filter.kind = q.kind === 'access' ? 'access' : { $ne: 'access' };
    if (q.group) filter.status = { $in: GROUP_STATUSES[q.group] };
    if (q.status) filter.status = q.status;
    if (q.category) filter.brokerCategory = q.category;
    if (q.q) filter.brokerName = { $regex: escapeRegex(q.q), $options: 'i' };
    const { page, limit, skip } = pageParams(q);
    const [items, total] = await Promise.all([
      this.requests.find(filter).sort({ lastActivityAt: -1, _id: -1 }).skip(skip).limit(limit),
      this.requests.countDocuments(filter),
    ]);
    return { items: items.map((r) => toListItem(r, r.createdAt)), total, page, limit };
  }

  async summary(userId: string, profileId?: string) {
    // The dashboard measures the removal work: right-of-access requests have their own page.
    const match: FilterQuery<RequestDoc> = { userId: new Types.ObjectId(userId), kind: { $ne: 'access' } };
    if (profileId) match.profileId = new Types.ObjectId(profileId);
    const [byStatus, byCategory, byMonth, covered, recent, tracked] = await Promise.all([
      this.requests.aggregate<{ _id: string; n: number }>([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      this.requests.aggregate<{ _id: { c: string; s: string }; n: number }>([
        { $match: { ...match, status: { $ne: 'cancelled' } } },
        { $group: { _id: { c: '$brokerCategory', s: '$status' }, n: { $sum: 1 } } },
      ]),
      this.requests.aggregate<{ _id: string; n: number }>([
        { $match: { ...match, completedAt: { $exists: true } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$completedAt' } }, n: { $sum: 1 } } },
      ]),
      this.requests.distinct('brokerKey', { ...match, custom: { $exists: false }, status: { $ne: 'cancelled' } }),
      this.requests.find(match).sort({ lastActivityAt: -1 }).limit(10),
      this.brokers.count(),
    ]);
    const counts: RequestCounts = emptyCounts();
    for (const s of byStatus) addToCounts(counts, s._id, s.n);
    const denom = counts.total - counts.notRemovable;

    const cat = new Map<string, { total: number; completed: number }>();
    for (const row of byCategory) {
      const e = cat.get(row._id.c) ?? { total: 0, completed: 0 };
      e.total += row.n;
      if (row._id.s === 'completed') e.completed += row.n;
      cat.set(row._id.c, e);
    }
    const months: { month: string; count: number }[] = [];
    const now = this.engine.clock.now();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      months.push({ month: key, count: byMonth.find((m) => m._id === key)?.n ?? 0 });
    }
    return {
      counts,
      coverage: {
        brokersTracked: tracked.total,
        brokersCovered: covered.length,
        brokersNotYetCovered: Math.max(0, tracked.total - covered.length),
      },
      completionRate: denom > 0 ? Math.round((counts.completed / denom) * 1000) / 1000 : 0,
      byCategory: [...cat.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.total - a.total),
      completedByMonth: months,
      recentActivity: recent.map((r) => {
        const last = r.timeline[r.timeline.length - 1];
        return {
          at: r.lastActivityAt.toISOString(),
          requestId: String(r._id),
          brokerName: r.brokerName,
          text: ACTIVITY_TEXT[last?.type ?? 'note'] ?? 'Aggiornamento',
        };
      }),
    };
  }

  private async toDetail(r: RequestDoc) {
    const profile = await this.data.getOwned(String(r.userId), String(r.profileId)).catch(() => null);
    const broker = r.custom ? null : await this.brokers.getRaw(r.brokerKey);
    const messages = await this.messages.find({ requestId: r._id }).sort({ at: 1 });
    const pii = profile ? this.data.pii(profile) : null;
    const lang = r.custom?.contactEmail ? (r.custom.contactEmail.endsWith('.it') ? 'it' : 'en') : 'it';
    const now = this.engine.clock.now();
    const canRemind =
      r.channel === 'email' &&
      ['sent', 'replied', 'overdue'].includes(r.status) &&
      !!r.lastOutgoingAt &&
      r.lastOutgoingAt <= addDays(now, -this.config.reminderIntervalDays) &&
      profile?.status === 'active';
    return {
      ...toListItem(r, r.createdAt),
      broker: broker ? toBrokerDto(broker) : this.customBroker(r),
      findings: r.findings
        ? {
            found: r.findings.found,
            categories: r.findings.categories,
            note: r.findings.noteEnc ? this.crypto.decrypt(r.findings.noteEnc) : null,
            recordedAt: r.findings.recordedAt.toISOString(),
          }
        : null,
      timeline: r.timeline.map((t) => ({ at: t.at.toISOString(), type: t.type, ...(t.status ? { status: t.status } : {}), ...(t.note ? { note: t.note } : {}) })),
      messages: messages.map((m) => ({
        id: String(m._id),
        direction: m.direction,
        at: m.at.toISOString(),
        from: m.from,
        to: m.to,
        subject: this.crypto.decrypt(m.subjectEnc),
        text: this.crypto.decrypt(m.textEnc),
        classification: (m.classification as ReplyLabel | undefined) ?? null,
        dryRun: m.dryRun,
        via: m.via ?? (m.direction === 'in' ? 'inbound' : m.dryRun ? 'dry-run' : 'resend'),
        attachments: m.attachments.map((a) => ({
          id: String(a._id),
          filename: a.filename,
          contentType: a.contentType,
          ...(a.size !== undefined ? { size: a.size } : {}),
          downloadable: !!a.fileId && !!a.expiresAt && a.expiresAt > now,
          expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
        })),
      })),
      manual:
        r.channel === 'manual' && pii
          ? {
              steps: r.manual?.steps ?? [],
              ...(r.manual?.url ? { url: r.manual.url } : {}),
              ...(r.manual?.phone ? { phone: r.manual.phone } : {}),
              ...(r.manual?.email ? { email: r.manual.email } : {}),
              prefillText: manualRequestText({
                lang,
                brokerName: r.brokerName,
                shortRef: r.shortRef,
                operatorName: this.config.operatorName,
                pii,
                cycle: r.cycle,
                kind: r.kind,
              }),
            }
          : null,
      canRemind,
      canEscalate: r.status === 'overdue' || r.status === 'escalated',
      canProvideId: r.channel === 'email' && r.status === 'action_required' && r.actionReason === 'id_required',
      canSimulateReply: this.config.mailMode === 'dry-run' && r.channel === 'email' && SIMULABLE.includes(r.status),
    };
  }

  private customBroker(r: RequestDoc): BrokerDtoShape {
    return {
      id: r.brokerKey,
      name: r.brokerName,
      website: r.brokerWebsite ?? null,
      category: 'other',
      hqCountry: null,
      verificationStatus: 'needs_research',
      lastVerified: null,
      channelTypes: r.custom?.contactEmail ? ['email'] : [],
      channels: [],
      legalBasisNote: null,
      obstacles: null,
      idRequested: null,
      sendEnabled: false,
      notes: r.custom?.notes ?? null,
    };
  }

  async getDetail(userId: string, id: string) {
    return this.toDetail(await this.owned(userId, id));
  }

  // ------------------------------------------------------------------ user actions
  async markDone(userId: string, id: string) {
    const r = await this.owned(userId, id);
    if (r.status !== 'action_required' || r.channel !== 'manual') {
      throw conflict('Only manual actions can be marked as done', 'INVALID_STATE');
    }
    const now = this.engine.clock.now();
    this.engine.timeline(r, 'marked_done');
    if (r.brokerCategory === 'opposition_register') {
      // Registration with the RPO takes effect on its own: nothing to wait for.
      this.engine.transition(r, 'completed', { note: 'Iscrizione effettuata' });
      r.completedAt = now;
    } else {
      r.sentAt = now;
      r.dueAt = addDays(now, this.config.responseDeadlineDays);
      r.lastOutgoingAt = now;
      this.engine.transition(r, 'sent', { silent: true });
    }
    await r.save();
    return this.toDetail(r);
  }

  async outcome(userId: string, id: string, dto: OutcomeDto) {
    const r = await this.owned(userId, id);
    const now = this.engine.clock.now();
    switch (dto.outcome) {
      case 'completed':
        this.engine.transition(r, 'completed', { note: dto.note });
        r.completedAt = now;
        r.nextCheckAt = addDays(now, this.config.renewalDays);
        break;
      case 'refused':
        this.engine.transition(r, 'refused', { note: dto.note });
        break;
      case 'action_required':
        this.engine.transition(r, 'action_required', { reason: 'reply_review', note: dto.note });
        break;
      case 'in_progress':
        this.engine.transition(r, 'sent', { note: dto.note });
        break;
    }
    await r.save();
    return this.toDetail(r);
  }

  async provideId(userId: string, id: string, file: Express.Multer.File | undefined, note?: string) {
    if (!file) throw badRequest('A file is required', 'VALIDATION_ERROR');
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)) {
      throw badRequest('Only PDF, JPG or PNG files are accepted', 'VALIDATION_ERROR');
    }
    const r = await this.owned(userId, id);
    if (!(r.channel === 'email' && r.status === 'action_required' && r.actionReason === 'id_required')) {
      throw conflict('This request is not waiting for an identity document', 'INVALID_STATE');
    }
    try {
      await this.engine.sendIdDocument(r, file, note?.slice(0, 500));
    } catch (err) {
      if (err instanceof MailError) throw conflict(`Could not forward the document: ${err.message}`, 'INVALID_STATE');
      throw err;
    }
    return this.toDetail(r);
  }

  async remind(userId: string, id: string) {
    const r = await this.owned(userId, id);
    const detail = await this.toDetail(r);
    if (!detail.canRemind) throw conflict('A reminder cannot be sent now', 'INVALID_STATE');
    try {
      await this.engine.sendReminder(r, true);
    } catch (err) {
      if (err instanceof MailError) throw conflict(`Reminder failed: ${err.message}`, 'INVALID_STATE');
      throw err;
    }
    return this.toDetail(r);
  }

  async escalate(userId: string, id: string) {
    const r = await this.owned(userId, id);
    if (r.status === 'overdue') {
      this.engine.transition(r, 'escalated');
      this.engine.timeline(r, 'escalated', 'escalated', 'Bozza di reclamo al Garante generata');
      await r.save();
    } else if (r.status !== 'escalated') {
      throw conflict('Only overdue requests can be escalated', 'INVALID_STATE');
    }
    const text = await this.complaintFor(r);
    return {
      text,
      generatedAt: this.engine.clock.now().toISOString(),
      pdfUrl: `/api/v1/requests/${String(r._id)}/complaint.pdf`,
      submitUrl: GARANTE_RECLAMO_URL,
      steps: [
        'Scarica il PDF della bozza e controlla i dati.',
        'Stampalo e firmalo (o firmalo digitalmente) e aggiungi una copia del tuo documento di identità.',
        `Allega la delega, la richiesta inviata e i solleciti (li trovi nella cronologia di questa pagina).`,
        `Presentalo al Garante dal portale online (${GARANTE_PORTAL_URL}) oppure via PEC a protocollo@pec.gpdp.it (l'indirizzo accetta solo messaggi inviati da PEC).`,
        'Non siamo un legale: se il caso è complesso valuta di sentire un professionista.',
      ],
    };
  }

  private async complaintFor(r: RequestDoc): Promise<string> {
    const profile = await this.data.getOwned(String(r.userId), String(r.profileId));
    const broker = r.custom ? null : await this.brokers.getRaw(r.brokerKey);
    const sentAt = r.sentAt ?? r.createdAt;
    const reminders = r.timeline.filter((t) => t.type === 'reminder_sent').map((t) => ({ on: t.at.toISOString().slice(0, 10) }));
    return complaintText({
      pii: this.data.pii(profile),
      brokerName: r.brokerName,
      brokerWebsite: broker?.website ?? r.brokerWebsite,
      shortRef: r.shortRef,
      sentOn: sentAt.toISOString().slice(0, 10),
      dueOn: (r.dueAt ?? addDays(sentAt, this.config.responseDeadlineDays)).toISOString().slice(0, 10),
      reminders,
      operatorName: this.config.operatorName,
      generatedOn: this.engine.clock.now().toISOString().slice(0, 10),
    });
  }

  async complaintPdf(userId: string, id: string): Promise<Buffer> {
    const r = await this.owned(userId, id);
    if (r.status !== 'escalated') throw conflict('Prepare the complaint first', 'INVALID_STATE');
    const profile = await this.data.getOwned(userId, String(r.profileId));
    return this.pdf.render({
      title: 'Reclamo al Garante per la protezione dei dati personali',
      body: await this.complaintFor(r),
      meta: `Bozza generata da ${this.config.operatorName} per ${fullName(this.data.pii(profile))} - riferimento ${r.shortRef}`,
    });
  }

  async cancel(userId: string, id: string) {
    const r = await this.owned(userId, id);
    this.engine.transition(r, 'cancelled', { note: 'Annullata dall\'utente' });
    r.nextAttemptAt = undefined;
    await r.save();
    return this.toDetail(r);
  }

  async simulateReply(userId: string, id: string, dto: SimulateReplyDto) {
    if (this.config.mailMode !== 'dry-run') throw forbidden('Simulation is only available in dry-run mode', 'SIMULATION_DISABLED');
    const r = await this.owned(userId, id);
    if (r.channel !== 'email' || !SIMULABLE.includes(r.status)) {
      throw conflict('A reply cannot be simulated for this request', 'INVALID_STATE');
    }
    const profile = await this.data.getOwned(userId, String(r.profileId));
    const broker = r.custom ? null : await this.brokers.getRaw(r.brokerKey);
    const fromDomain = broker?.domain ?? r.custom?.contactEmail?.split('@')[1] ?? 'example.org';
    await this.engine.applyReply(r, {
      from: `privacy@${fromDomain}`,
      to: [this.data.replyAddress(profile)],
      subject: `Re: Richiesta di cancellazione [${r.shortRef}]`,
      text: r.kind === 'access' ? SIMULATED_ACCESS_TEXT[dto.kind] : SIMULATED_TEXT[dto.kind],
      at: this.engine.clock.now(),
      dryRun: true,
    });
    return this.toDetail(r);
  }

  // ------------------------------------------------------------------ right of access (art. 15)
  async createAccess(user: AuthUser, dto: CreateAccessRequestsDto) {
    const profile = await this.data.getOwned(user.id, dto.profileId);
    if (profile.status !== 'active') throw conflict('Activate the profile first', 'PROFILE_NOT_READY');
    if (!this.identity.isVerified(profile)) {
      throw forbidden('Verify the contacts of the profile first', 'IDENTITY_REQUIRED');
    }
    const created: ListItemShape[] = [];
    const skipped: { brokerId: string; reason: 'exists' | 'not_contactable' | 'not_found' }[] = [];
    for (const brokerId of [...new Set(dto.brokerIds)]) {
      const broker = await this.brokers.getRaw(brokerId);
      if (!broker) {
        skipped.push({ brokerId, reason: 'not_found' });
        continue;
      }
      const plan = planChannel(broker);
      const excluded = ['opposition_register', 'regulator', 'search_engine'].includes(broker.category);
      if (!plan || excluded || !broker.sendEnabled) {
        skipped.push({ brokerId, reason: 'not_contactable' });
        continue;
      }
      const doc = await this.engine.createRequest(profile, {
        kind: 'access',
        brokerKey: broker.slug,
        brokerName: broker.name,
        brokerWebsite: broker.website,
        brokerCategory: broker.category,
        plan,
        cycle: 1,
      });
      if (doc) created.push(toListItem(doc, doc.createdAt));
      else skipped.push({ brokerId, reason: 'exists' });
    }
    return { created, skipped };
  }

  async recordFindings(userId: string, id: string, dto: AccessFindingsDto) {
    const r = await this.owned(userId, id);
    if (r.kind !== 'access') throw conflict('Findings can only be recorded on access requests', 'INVALID_STATE');
    r.findings = {
      found: dto.found,
      categories: dto.found ? [...new Set(dto.categories)] : [],
      ...(dto.note?.trim() ? { noteEnc: this.crypto.encrypt(dto.note.trim()) } : {}),
      recordedAt: this.engine.clock.now(),
    };
    this.engine.timeline(r, 'note', undefined, dto.found ? 'Esito registrato: dati presenti' : 'Esito registrato: nessun dato');
    r.markModified('findings');
    await r.save();
    return this.toDetail(r);
  }

  async dataMap(userId: string, profileId: string) {
    await this.data.getOwned(userId, profileId);
    const docs = await this.requests
      .find({ userId: new Types.ObjectId(userId), profileId: new Types.ObjectId(profileId), kind: 'access', status: { $ne: 'cancelled' } })
      .sort({ createdAt: -1 });
    const latest = new Map<string, RequestDoc>();
    for (const d of docs) if (!latest.has(d.brokerKey)) latest.set(d.brokerKey, d);
    const entries = [...latest.values()].map((d) => ({
      requestId: String(d._id),
      shortRef: d.shortRef,
      broker: { id: d.brokerKey, name: d.brokerName, website: d.brokerWebsite ?? null, category: d.brokerCategory },
      status: d.status,
      found: d.findings ? d.findings.found : null,
      categories: d.findings?.categories ?? [],
      updatedAt: (d.findings?.recordedAt ?? d.lastActivityAt).toISOString(),
    }));
    const counts = new Map<string, number>();
    for (const e of entries) if (e.found) for (const c of e.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    return {
      entries: entries.sort((a, b) => a.broker.name.localeCompare(b.broker.name)),
      totals: {
        asked: entries.length,
        answered: entries.filter((e) => e.found !== null).length,
        found: entries.filter((e) => e.found === true).length,
        notFound: entries.filter((e) => e.found === false).length,
      },
      categoryCounts: [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    };
  }

  /** Incoming files (never outgoing documents) are kept encrypted until their retention ends. */
  async attachment(userId: string, requestId: string, messageId: string, attachmentId: string) {
    const r = await this.owned(userId, requestId);
    const message = await this.messages.findOne({ _id: messageId, requestId: r._id });
    const att = message?.attachments.find((a) => String(a._id) === attachmentId);
    if (!message || !att || message.direction !== 'in' || !att.fileId) throw new NotFoundException('Attachment not found');
    const file = await this.files.findById(att.fileId);
    if (!file || file.expiresAt <= this.engine.clock.now()) throw new NotFoundException('Attachment expired');
    const safeType = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|text\/plain|application\/zip|application\/json|text\/csv)$/i.test(file.contentType) ? file.contentType : 'application/octet-stream';
    return { filename: file.filename, contentType: safeType, data: this.crypto.decryptBuffer(file.dataEnc) };
  }

  async createCustom(user: AuthUser, dto: CustomRequestDto) {
    const profile = await this.data.getOwned(user.id, dto.profileId);
    if (profile.status !== 'active') throw conflict('Activate the profile first', 'PROFILE_NOT_READY');
    const monthStart = new Date(Date.UTC(this.engine.clock.now().getUTCFullYear(), this.engine.clock.now().getUTCMonth(), 1));
    const used = await this.requests.countDocuments({ userId: new Types.ObjectId(user.id), custom: { $exists: true }, createdAt: { $gte: monthStart } });
    if (used >= this.config.customRequestsPerMonth) throw conflict('Monthly limit of custom requests reached', 'CUSTOM_LIMIT_REACHED');

    const ref = newShortRef();
    const plan: ChannelPlan = dto.contactEmail
      ? { channel: 'email', email: dto.contactEmail.toLowerCase() }
      : {
          channel: 'manual',
          actionReason: 'manual_steps',
          manual: {
            steps: [
              `Cerca nel sito ${dto.website ?? dto.name} la pagina "privacy" o "rimozione dati" e individua il modulo o l'indirizzo email del titolare.`,
              'Invia la richiesta usando il testo qui sotto.',
              'Quando hai inviato premi «Fatto»: controlleremo la scadenza dei 30 giorni.',
            ],
            url: dto.website,
          },
        };
    const doc = await this.engine.createRequest(profile, {
      brokerKey: `custom:${ref.toLowerCase()}`,
      brokerName: dto.name.trim(),
      brokerWebsite: dto.website,
      brokerCategory: 'other',
      plan,
      cycle: 1,
      custom: { name: dto.name.trim(), website: dto.website, contactEmail: dto.contactEmail?.toLowerCase(), notes: dto.notes },
    });
    if (!doc) throw conflict('Could not create the request, try again', 'INVALID_STATE');
    return toListItem(doc, doc.createdAt);
  }
}

