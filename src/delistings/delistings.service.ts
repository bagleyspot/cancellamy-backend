import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Delisting, DelistingDoc } from '../db/schemas';
import { Clock, addDays } from '../common/clock';
import { conflict } from '../common/errors';
import { Paginated, pageParams } from '../common/pagination';
import { NotificationsService } from '../notifications/notifications.service';
import { ProfileDataService } from '../profiles/profile-data.service';
import { fullName } from '../profiles/profile.types';
import { DelistingInputDto, DelistingPatchDto, DelistingQuery } from './delistings.dto';

const MAX_PER_USER = 100;
const FOLLOW_UP_DAYS = 30;

/** Allowed status changes (a denied or partial result can be appealed). */
const TRANSITIONS: Record<string, string[]> = {
  to_submit: ['submitted', 'cancelled'],
  submitted: ['approved', 'partially_approved', 'denied', 'cancelled'],
  denied: ['appealed', 'cancelled'],
  partially_approved: ['appealed', 'cancelled'],
  appealed: ['approved', 'partially_approved', 'denied', 'cancelled'],
  approved: [],
  cancelled: [],
};

const REASONS: Record<string, string> = {
  outdated: "le informazioni sono obsolete e non più rilevanti rispetto al tempo trascorso",
  irrelevant: 'le informazioni non sono pertinenti rispetto alle finalità del trattamento e non rivestono interesse pubblico',
  inaccurate: 'le informazioni sono inesatte o fuorvianti',
  excessive: 'le informazioni sono eccessive rispetto alle finalità per cui sono state pubblicate',
  no_public_interest: 'sono un privato cittadino e non esiste un interesse pubblico prevalente alla reperibilità di queste informazioni',
  other: 'sussistono i presupposti previsti dall\'art. 17 GDPR',
};

export interface DelistingDtoShape {
  id: string;
  profileId: string;
  engine: string;
  url: string;
  searchQuery: string | null;
  reason: string;
  explanation: string | null;
  status: string;
  submittedAt: string | null;
  resolvedAt: string | null;
  followUpAt: string | null;
  note: string | null;
  createdAt: string;
}

const iso = (d?: Date | null) => (d ? d.toISOString() : null);

function toDto(d: DelistingDoc): DelistingDtoShape {
  return {
    id: String(d._id),
    profileId: String(d.profileId),
    engine: d.engine,
    url: d.url,
    searchQuery: d.searchQuery ?? null,
    reason: d.reason,
    explanation: d.explanation ?? null,
    status: d.status,
    submittedAt: iso(d.submittedAt),
    resolvedAt: iso(d.resolvedAt),
    followUpAt: iso(d.followUpAt),
    note: d.note ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

@Injectable()
export class DelistingsService {
  constructor(
    @InjectModel(Delisting.name) private readonly delistings: Model<DelistingDoc>,
    private readonly data: ProfileDataService,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  private async owned(userId: string, id: string): Promise<DelistingDoc> {
    const d = await this.delistings.findOne({ _id: id, userId: new Types.ObjectId(userId) });
    if (!d) throw new NotFoundException('Delisting request not found');
    return d;
  }

  async list(userId: string, q: DelistingQuery): Promise<Paginated<DelistingDtoShape>> {
    const filter: FilterQuery<DelistingDoc> = { userId: new Types.ObjectId(userId) };
    if (q.profileId) filter.profileId = new Types.ObjectId(q.profileId);
    if (q.status) filter.status = q.status;
    const { page, limit, skip } = pageParams(q);
    const [items, total] = await Promise.all([
      this.delistings.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      this.delistings.countDocuments(filter),
    ]);
    return { items: items.map(toDto), total, page, limit };
  }

  async create(userId: string, dto: DelistingInputDto): Promise<DelistingDtoShape> {
    await this.data.getOwned(userId, dto.profileId);
    const count = await this.delistings.countDocuments({ userId: new Types.ObjectId(userId) });
    if (count >= MAX_PER_USER) throw conflict('Delisting request limit reached', 'CUSTOM_LIMIT_REACHED');
    const doc = await this.delistings.create({
      userId: new Types.ObjectId(userId),
      profileId: new Types.ObjectId(dto.profileId),
      engine: dto.engine,
      url: dto.url,
      searchQuery: dto.searchQuery?.trim() || undefined,
      reason: dto.reason,
      explanation: dto.explanation?.trim() || undefined,
      status: 'to_submit',
    });
    return toDto(doc);
  }

  async get(userId: string, id: string): Promise<DelistingDtoShape> {
    return toDto(await this.owned(userId, id));
  }

  async patch(userId: string, id: string, dto: DelistingPatchDto): Promise<DelistingDtoShape> {
    const d = await this.owned(userId, id);
    if (dto.status && dto.status !== d.status) {
      if (!(TRANSITIONS[d.status] ?? []).includes(dto.status)) {
        throw conflict(`Cannot move a delisting request from ${d.status} to ${dto.status}`, 'INVALID_STATE');
      }
      const now = this.clock.now();
      d.status = dto.status;
      if (dto.status === 'submitted') {
        d.submittedAt = now;
        d.followUpAt = addDays(now, FOLLOW_UP_DAYS);
        d.followUpNotifiedAt = undefined;
      }
      if (['approved', 'partially_approved', 'denied'].includes(dto.status)) {
        d.resolvedAt = now;
        d.followUpAt = undefined;
      }
      if (dto.status === 'appealed') {
        d.resolvedAt = undefined;
        d.followUpAt = addDays(now, FOLLOW_UP_DAYS);
        d.followUpNotifiedAt = undefined;
      }
      if (dto.status === 'cancelled') d.followUpAt = undefined;
    }
    if (dto.note !== undefined) d.note = dto.note.trim() || undefined;
    if (dto.explanation !== undefined) d.explanation = dto.explanation.trim() || undefined;
    await d.save();
    return toDto(d);
  }

  async remove(userId: string, id: string): Promise<void> {
    const d = await this.owned(userId, id);
    await d.deleteOne();
  }

  async guide(userId: string, id: string) {
    const d = await this.owned(userId, id);
    const profile = await this.data.getOwned(userId, String(d.profileId));
    const name = fullName(this.data.pii(profile));
    const query = d.searchQuery ?? name;
    const statement = [
      `Mi chiamo ${name}. Chiedo la rimozione dell'URL ${d.url} dai risultati di ricerca per la query «${query}», ai sensi dell'art. 17 del Regolamento (UE) 2016/679 (GDPR) e secondo i principi della sentenza della Corte di giustizia dell'UE C-131/12.`,
      `Motivo: ${REASONS[d.reason] ?? REASONS['other']}.`,
      ...(d.explanation ? [d.explanation] : []),
      'Chiedo che il risultato non sia più mostrato per ricerche effettuate a partire dal mio nome. Resto a disposizione per fornire ulteriori informazioni.',
    ].join('\n\n');
    if (d.engine === 'google') {
      return {
        engineName: 'Google',
        formUrl: 'https://reportcontent.google.com/forms/rtbf',
        steps: [
          'Apri il modulo ufficiale di Google per chiedere la rimozione di risultati di ricerca secondo la normativa europea sulla protezione dei dati.',
          'Indica il paese di residenza (Italia) e il tuo nome.',
          `Incolla l'indirizzo della pagina: ${d.url}`,
          `Indica la ricerca per cui il risultato deve sparire: ${query}`,
          'Incolla la motivazione preparata qui sotto e indica un indirizzo email a cui Google possa risponderti.',
          'Se Google lo richiede, allega il documento di identità direttamente nel modulo: Cancellamy non lo vede né lo conserva.',
          'Invia, conserva l\'email di conferma e torna qui a premere «L\'ho inviata».',
        ],
        statement,
        tips: [
          'Google valuta l\'interesse pubblico: notizie recenti su ruoli pubblici o su reati difficilmente vengono rimosse.',
          'La rimozione vale per le ricerche con il tuo nome: la pagina resta online. Per toglierla alla fonte scrivi al sito (richiesta di cancellazione, art. 17).',
          'Non c\'è un termine garantito per la risposta: ti ricordiamo di controllare dopo 30 giorni.',
          'Se la richiesta è respinta puoi ricorrere al Garante o al tribunale: usa «Ricorso» per tenerne traccia.',
        ],
      };
    }
    if (d.engine === 'bing') {
      return {
        engineName: 'Bing',
        formUrl: 'https://www.bing.com/webmaster/tools/eu-privacy-request',
        steps: [
          'Apri il modulo ufficiale di Microsoft per bloccare risultati di Bing nello Spazio economico europeo.',
          'Indica il tuo nome e il paese di residenza; Bing può chiedere di verificarli con un documento da caricare nel modulo.',
          `Incolla l'indirizzo della pagina: ${d.url}`,
          `Indica la ricerca per cui il risultato deve sparire: ${query}`,
          'Incolla la motivazione preparata qui sotto.',
          'Invia, conserva la conferma e torna qui a premere «L\'ho inviata».',
        ],
        statement,
        tips: [
          'Microsoft precisa che la richiesta non garantisce il blocco del risultato.',
          'Il blocco non rimuove la pagina dal web: per quello contatta il sito.',
        ],
      };
    }
    return {
      engineName: 'Altro motore di ricerca',
      formUrl: null,
      steps: [
        'Cerca nella pagina privacy del motore di ricerca il modulo per le richieste di rimozione secondo il GDPR.',
        `Indica l'indirizzo della pagina: ${d.url} e la ricerca: ${query}`,
        'Incolla la motivazione preparata qui sotto.',
        'Conserva la conferma e torna qui a premere «L\'ho inviata».',
      ],
      statement,
      tips: ['Se non esiste un modulo, scrivi al responsabile della protezione dei dati del motore di ricerca citando l\'art. 17 GDPR.'],
    };
  }

  /** Scheduler: remind the user to check the outcome 30 days after the submission. */
  async notifyFollowUps(limit: number): Promise<number> {
    const now = this.clock.now();
    const due = await this.delistings
      .find({ status: { $in: ['submitted', 'appealed'] }, followUpAt: { $lte: now }, followUpNotifiedAt: { $exists: false } })
      .limit(limit);
    let n = 0;
    for (const d of due) {
      const claimed = await this.delistings.findOneAndUpdate({ _id: d._id, followUpNotifiedAt: { $exists: false } }, { $set: { followUpNotifiedAt: now } });
      if (!claimed) continue;
      await this.notifications.notify(d.userId, {
        type: 'system',
        title: 'Hai ricevuto risposta alla richiesta di deindicizzazione?',
        body: `Sono passati ${FOLLOW_UP_DAYS} giorni dall'invio della richiesta per ${d.url}. Controlla l'esito e aggiorna lo stato.`,
        appPath: '/app/deindicizzazione',
      });
      n += 1;
    }
    return n;
  }
}
