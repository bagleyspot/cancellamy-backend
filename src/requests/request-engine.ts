import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomInt } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AttachmentFile, AttachmentFileDoc, Broker, Message, MessageDoc, Profile, ProfileDoc, RemovalRequest, RequestDoc } from '../db/schemas';
import { Clock, addDays } from '../common/clock';
import { CryptoService } from '../common/crypto.service';
import { conflict } from '../common/errors';
import { MailAttachment, MailError } from '../mail/mail.types';
import { NotificationsService } from '../notifications/notifications.service';
import { ProfileDataService } from '../profiles/profile-data.service';
import { ProfilePii, fullName } from '../profiles/profile.types';
import { BrokersService } from '../brokers/brokers.service';
import { profileCountries, selectBrokersForProfile } from '../brokers/relevance';
import { Lang, RequestEmailContext, accessEmail, erasureEmail, idProvidedEmail, reminderEmail } from '../templates/request-templates';
import { OutboundService } from '../sender/outbound.service';
import { SenderAuthError } from '../sender/smtp-sender.service';
import { ChannelPlan, planChannel } from './channel-plan';
import { ReplyLabel, classifyReply, indicatesNoData } from './reply-classifier';
import { RequestStatus, canTransition } from './status';
import { MailQuotaService } from '../mail/mail-quota.service';

const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const MAX_REMINDERS = 2;
export const MAX_SEND_ATTEMPTS = 5;

/** Multer decodes multipart file names as latin1: restore UTF-8, then keep a conservative character set. */
export function safeFilename(original: string): string {
  const utf8 = Buffer.from(original, 'latin1').toString('utf8');
  const decoded = utf8.includes('\uFFFD') ? original : utf8;
  return decoded.replace(/[^\w.\- ]/g, '_').slice(0, 80) || 'documento';
}

export function newShortRef(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `CNC-${s}`;
}

export interface IncomingAttachment {
  filename: string;
  contentType: string;
  size?: number;
  /** Bytes of an incoming file; stored encrypted until the retention period ends. */
  content?: Buffer;
}

export interface NewRequestSpec {
  kind?: 'erasure' | 'access';
  brokerKey: string;
  brokerName: string;
  brokerWebsite?: string;
  brokerCategory: string;
  plan: ChannelPlan;
  cycle: number;
  custom?: { name: string; website?: string; contactEmail?: string; notes?: string };
  scheduledAt?: Date;
}

export interface InboundMessageInput {
  from: string;
  to: string[];
  subject: string;
  text: string;
  at: Date;
  providerId?: string;
  dryRun: boolean;
  attachments?: IncomingAttachment[];
}

@Injectable()
export class RequestEngine {
  private readonly logger = new Logger(RequestEngine.name);

  constructor(
    @InjectModel(RemovalRequest.name) readonly requests: Model<RequestDoc>,
    @InjectModel(Message.name) readonly messages: Model<MessageDoc>,
    @InjectModel(Profile.name) readonly profiles: Model<ProfileDoc>,
    @InjectModel(AttachmentFile.name) private readonly files: Model<AttachmentFileDoc>,
    readonly data: ProfileDataService,
    private readonly brokers: BrokersService,
    private readonly crypto: CryptoService,
    private readonly outbound: OutboundService,
    private readonly notifications: NotificationsService,
    readonly mailQuota: MailQuotaService,
    readonly clock: Clock,
    @Inject(APP_CONFIG) readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------------ helpers
  timeline(req: RequestDoc, type: string, status?: string, note?: string): void {
    const at = this.clock.now();
    req.timeline.push({ at, type, ...(status ? { status } : {}), ...(note ? { note } : {}) });
    req.lastActivityAt = at;
  }

  /** Validated state change. `silent` skips the status_changed timeline entry. */
  transition(req: RequestDoc, to: RequestStatus, opts: { reason?: string; note?: string; silent?: boolean } = {}): void {
    if (req.status !== to && !canTransition(req.status, to)) {
      throw conflict(`Cannot move a request from ${req.status} to ${to}`, 'INVALID_STATE');
    }
    req.status = to;
    req.actionReason = to === 'action_required' ? (opts.reason ?? 'reply_review') : undefined;
    if (!opts.silent) this.timeline(req, 'status_changed', to, opts.note);
    else req.lastActivityAt = this.clock.now();
  }

  private lang(req: RequestDoc, broker: Broker | null): Lang {
    if (req.custom?.contactEmail) return req.custom.contactEmail.toLowerCase().endsWith('.it') ? 'it' : 'en';
    if (!broker) return 'it';
    return broker.hqCountry === 'IT' || broker.domain?.endsWith('.it') ? 'it' : 'en';
  }

  private async context(req: RequestDoc, profile: ProfileDoc): Promise<{ ctx: RequestEmailContext; pii: ProfilePii; broker: Broker | null }> {
    const pii = this.data.pii(profile);
    const broker = req.custom ? null : await this.brokers.getRaw(req.brokerKey);
    const ctx: RequestEmailContext = {
      lang: this.lang(req, broker),
      brokerName: req.brokerName,
      shortRef: req.shortRef,
      operatorName: this.config.operatorName,
      pii,
      cycle: req.cycle,
      kind: req.kind,
      firstSentOn: req.sentAt?.toISOString().slice(0, 10),
      dueOn: req.dueAt?.toISOString().slice(0, 10),
    };
    return { ctx, pii, broker };
  }

  private recipient(req: RequestDoc): string | undefined {
    return req.custom?.contactEmail ?? req.manual?.email;
  }

  async storeMessage(
    req: RequestDoc,
    m: {
      direction: 'out' | 'in';
      at: Date;
      from: string;
      to: string[];
      subject: string;
      text: string;
      providerId?: string;
      dryRun: boolean;
      via?: 'resend' | 'smtp' | 'dry-run' | 'inbound';
      classification?: ReplyLabel;
      attachments?: IncomingAttachment[];
    },
  ): Promise<MessageDoc> {
    const attachments: Array<{ filename: string; contentType: string; size?: number; fileId?: AttachmentFileDoc['_id']; expiresAt?: Date }> = [];
    for (const a of m.attachments ?? []) {
      const meta = { filename: a.filename, contentType: a.contentType, size: a.size ?? a.content?.length };
      if (m.direction === 'in' && a.content && a.content.length <= this.config.maxAttachmentBytes) {
        // Incoming files (for example the copy of the data of an access request) are kept encrypted for a limited time.
        const expiresAt = addDays(this.clock.now(), this.config.attachmentRetentionDays);
        const file = await this.files.create({
          userId: req.userId,
          requestId: req._id,
          filename: a.filename,
          contentType: a.contentType,
          size: a.content.length,
          dataEnc: this.crypto.encryptBuffer(a.content),
          expiresAt,
        });
        attachments.push({ ...meta, fileId: file._id, expiresAt });
      } else {
        attachments.push(meta);
      }
    }
    return this.messages.create({
      requestId: req._id,
      userId: req.userId,
      direction: m.direction,
      at: m.at,
      from: m.from,
      to: m.to,
      subjectEnc: this.crypto.encrypt(m.subject),
      textEnc: this.crypto.encrypt(m.text),
      providerId: m.providerId,
      dryRun: m.dryRun,
      via: m.via ?? (m.direction === 'in' ? 'inbound' : m.dryRun ? 'dry-run' : 'resend'),
      classification: m.classification,
      attachments,
    });
  }

  // ------------------------------------------------------------------ creation
  /** Inserts a request unless one already exists for (profile, broker, cycle). Returns null on duplicate. */
  async createRequest(profile: ProfileDoc, spec: NewRequestSpec): Promise<RequestDoc | null> {
    const now = this.clock.now();
    const isEmail = spec.plan.channel === 'email';
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const doc = new this.requests({
          userId: profile.userId,
          profileId: profile._id,
          brokerKey: spec.brokerKey,
          brokerName: spec.brokerName,
          brokerWebsite: spec.brokerWebsite,
          brokerCategory: spec.brokerCategory,
          shortRef: newShortRef(),
          kind: spec.kind ?? 'erasure',
          channel: spec.plan.channel,
          status: isEmail ? 'queued' : 'action_required',
          actionReason: isEmail ? undefined : spec.plan.actionReason,
          cycle: spec.cycle,
          custom: spec.custom,
          manual: spec.plan.manual,
          nextAttemptAt: isEmail ? (spec.scheduledAt ?? now) : undefined,
          lastActivityAt: now,
          timeline: [{ at: now, type: 'created', status: isEmail ? 'queued' : 'action_required' }],
        });
        if (isEmail && !spec.custom) {
          // Keep the recipient on the document so later broker edits cannot redirect an in-flight request.
          doc.manual = { steps: [], email: spec.plan.email };
        } else if (isEmail && spec.custom) {
          doc.manual = undefined;
        }
        await doc.save();
        return doc;
      } catch (err) {
        const e = err as { code?: number; keyPattern?: Record<string, unknown> };
        if (e.code !== 11000) throw err;
        if (e.keyPattern && 'shortRef' in e.keyPattern) continue; // regenerate the reference and retry
        return null; // duplicate (profile, broker, cycle)
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ sending
  /** Sends the first email of a request (erasure or access). Throws MailError on provider failure. */
  async sendInitial(req: RequestDoc): Promise<void> {
    const profile = await this.profiles.findById(req.profileId);
    if (!profile) throw new MailError('Profile no longer exists', false);
    const auth = await this.data.activeAuthorization(profile._id);
    if (!auth) throw new MailError('No active authorization', false);
    const to = this.recipient(req);
    if (!to) throw new MailError('Request has no recipient', false);
    const { ctx, pii } = await this.context(req, profile);
    const content = req.kind === 'access' ? accessEmail(ctx) : erasureEmail(ctx);
    const delega = await this.data.renderDelegaPdf(profile, auth);
    const attachments: MailAttachment[] = [{ filename: 'delega.pdf', content: delega, contentType: 'application/pdf' }];
    const now = this.clock.now();
    const from = this.outbound.from(profile, fullName(pii));
    const res = await this.outbound.send(profile, {
      from,
      to: [to],
      subject: content.subject,
      text: content.text,
      replyTo: this.data.replyAddress(profile),
      headers: { 'X-Cancellamy-Ref': req.shortRef },
      attachments,
      idempotencyKey: `req-${String(req._id)}-${req.kind === 'access' ? 'access' : 'erasure'}`,
      tags: [{ name: 'request', value: req.shortRef }],
    });
    await this.storeMessage(req, {
      direction: 'out',
      at: now,
      from,
      to: [to],
      subject: content.subject,
      text: content.text,
      providerId: res.id,
      dryRun: res.dryRun,
      via: res.via,
      attachments: [{ filename: 'delega.pdf', contentType: 'application/pdf', size: delega.length }],
    });
    req.dryRun = res.dryRun;
    req.sentAt = now;
    req.dueAt = addDays(now, this.config.responseDeadlineDays);
    req.lastOutgoingAt = now;
    req.attempts += 1;
    req.nextAttemptAt = undefined;
    req.lastError = undefined;
    this.timeline(req, 'sent', 'sent', res.dryRun ? 'dry-run' : undefined);
    this.transition(req, 'sent', { silent: true });
    await req.save();
  }

  async sendReminder(req: RequestDoc, manual = false): Promise<void> {
    const profile = await this.profiles.findById(req.profileId);
    const to = this.recipient(req);
    if (!profile || !to) throw new MailError('Cannot send reminder', false);
    const auth = await this.data.activeAuthorization(profile._id);
    if (!auth) throw new MailError('No active authorization', false);
    const { ctx, pii } = await this.context(req, profile);
    const number = req.reminderCount + 1;
    const content = reminderEmail({ ...ctx, reminderNumber: number });
    const delega = await this.data.renderDelegaPdf(profile, auth);
    const now = this.clock.now();
    const from = this.outbound.from(profile, fullName(pii));
    const res = await this.outbound.send(profile, {
      from,
      to: [to],
      subject: content.subject,
      text: content.text,
      replyTo: this.data.replyAddress(profile),
      headers: { 'X-Cancellamy-Ref': req.shortRef },
      attachments: [{ filename: 'delega.pdf', content: delega, contentType: 'application/pdf' }],
      idempotencyKey: `req-${String(req._id)}-reminder-${number}`,
      tags: [{ name: 'request', value: req.shortRef }],
    });
    await this.storeMessage(req, {
      direction: 'out',
      at: now,
      from,
      to: [to],
      subject: content.subject,
      text: content.text,
      providerId: res.id,
      dryRun: res.dryRun,
      via: res.via,
      attachments: [{ filename: 'delega.pdf', contentType: 'application/pdf', size: delega.length }],
    });
    req.reminderCount = number;
    req.lastOutgoingAt = now;
    this.timeline(req, 'reminder_sent', undefined, `${manual ? 'manuale' : 'automatico'} n. ${number}${res.dryRun ? ' (dry-run)' : ''}`);
    await req.save();
  }

  async sendIdDocument(req: RequestDoc, file: { buffer: Buffer; originalname: string; mimetype: string; size: number }, note?: string): Promise<void> {
    const profile = await this.profiles.findById(req.profileId);
    const to = this.recipient(req);
    if (!profile || !to) throw new MailError('Cannot send document', false);
    const { ctx, pii } = await this.context(req, profile);
    const content = idProvidedEmail(ctx, note);
    const now = this.clock.now();
    const from = this.outbound.from(profile, fullName(pii));
    const res = await this.outbound.send(profile, {
      from,
      to: [to],
      subject: content.subject,
      text: content.text,
      replyTo: this.data.replyAddress(profile),
      headers: { 'X-Cancellamy-Ref': req.shortRef },
      attachments: [{ filename: safeFilename(file.originalname), content: file.buffer, contentType: file.mimetype }],
      idempotencyKey: `req-${String(req._id)}-id-${now.getTime()}`,
      tags: [{ name: 'request', value: req.shortRef }],
    });
    // Only metadata is persisted: the document itself is never stored.
    await this.storeMessage(req, {
      direction: 'out',
      at: now,
      from,
      to: [to],
      subject: content.subject,
      text: content.text,
      providerId: res.id,
      dryRun: res.dryRun,
      via: res.via,
      attachments: [{ filename: 'documento-identita (non conservato)', contentType: file.mimetype, size: file.size }],
    });
    req.lastOutgoingAt = now;
    req.dueAt = addDays(now, this.config.responseDeadlineDays);
    this.timeline(req, 'id_provided', 'sent', res.dryRun ? 'dry-run' : undefined);
    this.transition(req, 'sent', { silent: true });
    await req.save();
  }

  // ------------------------------------------------------------------ replies
  /** Stores an incoming message and moves the request according to the classified reply. */
  async applyReply(req: RequestDoc, input: InboundMessageInput): Promise<ReplyLabel> {
    const raw = classifyReply(input.subject, input.text);
    const access = req.kind === 'access';
    // Access requests: "we hold no data" resolves the request; cancellation wording makes no sense there.
    const noData = access && raw === 'refused' && indicatesNoData(input.subject, input.text);
    let label: ReplyLabel = raw;
    if (access && raw === 'completed') label = 'unknown';
    if (!access && raw === 'data_provided') label = 'unknown';
    if (noData) label = 'completed';

    await this.storeMessage(req, {
      direction: 'in',
      at: input.at,
      from: input.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      providerId: input.providerId,
      dryRun: input.dryRun,
      via: 'inbound',
      classification: label,
      attachments: input.attachments,
    });
    this.timeline(req, 'reply_received', undefined, label);
    if (label !== 'auto_reply' && !req.firstReplyAt) req.firstReplyAt = input.at;
    const now = this.clock.now();
    const open = ['sent', 'replied', 'overdue', 'escalated'].includes(req.status);
    const userId = req.userId;
    const path = `/app/richieste/${String(req._id)}`;

    if (open || req.status === 'action_required') {
      switch (label) {
        case 'data_provided':
          this.transition(req, 'completed');
          req.completedAt = now;
          await req.save();
          await this.notifications.notify(userId, {
            type: 'request_status',
            title: `${req.brokerName}: ha risposto con i tuoi dati`,
            body: 'Leggi la risposta e gli allegati (disponibili per un periodo limitato), poi registra cosa hai trovato.',
            requestId: req._id,
            appPath: path,
          });
          return label;
        case 'completed':
          this.transition(req, 'completed');
          req.completedAt = now;
          if (access) {
            req.findings = { found: false, categories: [], recordedAt: now };
            await req.save();
            await this.notifications.notify(userId, {
              type: 'request_status',
              title: `${req.brokerName}: non tratta dati che ti riguardano`,
              body: `${req.brokerName} ha dichiarato di non trattare dati su di te.`,
              requestId: req._id,
              appPath: path,
            });
            return label;
          }
          req.nextCheckAt = addDays(now, this.config.renewalDays);
          await req.save();
          await this.notifications.notify(userId, {
            type: 'request_status',
            title: `${req.brokerName}: dati cancellati`,
            body: `${req.brokerName} ha confermato la cancellazione. Controlleremo di nuovo tra ${this.config.renewalDays} giorni.`,
            requestId: req._id,
            appPath: path,
          });
          return label;
        case 'refused':
          this.transition(req, 'refused');
          await req.save();
          await this.notifications.notify(userId, {
            type: 'request_status',
            title: `${req.brokerName}: richiesta non accolta`,
            body: access
              ? `${req.brokerName} ha risposto che non può fornire i dati. Leggi la risposta: potresti valutare un reclamo al Garante.`
              : `${req.brokerName} ha risposto che non può cancellare i dati. Leggi la risposta: potresti valutare un reclamo al Garante.`,
            requestId: req._id,
            appPath: path,
          });
          return label;
        case 'id_required':
          this.transition(req, 'action_required', { reason: 'id_required' });
          await req.save();
          await this.notifications.notify(userId, {
            type: 'action_required',
            title: `${req.brokerName} chiede un documento di identità`,
            body: 'Per procedere serve che tu carichi un documento. Lo inoltriamo al broker senza conservarlo.',
            requestId: req._id,
            appPath: path,
          });
          return label;
        case 'more_info':
          this.transition(req, 'action_required', { reason: 'more_info' });
          await req.save();
          await this.notifications.notify(userId, {
            type: 'action_required',
            title: `${req.brokerName} chiede ulteriori informazioni`,
            body: 'Leggi la risposta e decidi come procedere.',
            requestId: req._id,
            appPath: path,
          });
          return label;
        case 'auto_reply':
          await req.save();
          return label;
        default:
          if (req.status === 'sent' || req.status === 'overdue') this.transition(req, 'replied');
          await req.save();
          await this.notifications.notify(userId, {
            type: 'request_status',
            title: `Nuova risposta da ${req.brokerName}`,
            body: 'Leggi la risposta e indica se la richiesta è stata accolta.',
            requestId: req._id,
            appPath: path,
          });
          return label;
      }
    }
    await req.save();
    return label;
  }

  /** The user's own mailbox stopped working: tell them once and let the requests wait. */
  async markSenderError(profileId: ProfileDoc['_id'], message: string): Promise<void> {
    const first = await this.profiles.findOneAndUpdate({ _id: profileId, senderError: { $exists: false } }, { $set: { senderError: message.slice(0, 300) } });
    if (!first) return;
    await this.notifications.notify(first.userId, {
      type: 'action_required',
      title: 'La tua casella di posta non funziona',
      body: 'Non riusciamo a inviare le richieste dalla tua casella. Aggiorna le impostazioni di invio o torna a Cancellamy: le richieste restano in attesa.',
      appPath: `/app/profili/${String(profileId)}`,
    });
  }

  // ------------------------------------------------------------------ scheduler tasks
  /** Atomically claims queued email requests whose profile is active, respecting global & per-user daily quotas. */
  async claimQueued(limit: number): Promise<RequestDoc[]> {
    const globalCheck = await this.mailQuota.canSendGlobal(this.config.mailMode, false);
    if (!globalCheck.allowed) {
      this.logger.warn(`claimQueued: ${globalCheck.reason}. Sospensione elaborazione coda.`);
      return [];
    }

    const now = this.clock.now();
    const claimed: RequestDoc[] = [];
    const activeProfiles = new Map<string, boolean>();
    const claimedPerUser = new Map<string, number>();

    for (let i = 0; i < limit * 3 && claimed.length < limit; i++) {
      const doc = await this.requests.findOneAndUpdate(
        {
          status: 'queued',
          channel: 'email',
          nextAttemptAt: { $lte: now },
          $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }],
        },
        { $set: { lockedUntil: new Date(now.getTime() + 5 * 60 * 1000) } },
        { sort: { nextAttemptAt: 1 }, new: true },
      );
      if (!doc) break;
      const key = String(doc.profileId);
      if (!activeProfiles.has(key)) {
        const p = await this.profiles.findById(doc.profileId).select('status senderError').lean();
        // Paused profiles and profiles whose own mailbox is broken wait without burning attempts.
        activeProfiles.set(key, p?.status === 'active' && !p.senderError);
      }
      if (!activeProfiles.get(key)) {
        // Paused/draft profile: postpone without burning attempts.
        await this.requests.updateOne({ _id: doc._id }, { $set: { nextAttemptAt: new Date(now.getTime() + 10 * 60 * 1000) }, $unset: { lockedUntil: 1 } });
        continue;
      }

      // Fair-share per-user check: maximum userDailyRequestLimit (default 5) requests sent per user per day
      const userIdStr = String(doc.userId);
      const userSentToday = await this.mailQuota.getUserDailySent(doc.userId);
      const userInBatch = claimedPerUser.get(userIdStr) ?? 0;

      if (userSentToday + userInBatch >= this.config.userDailyRequestLimit) {
        // User quota for today reached. Postpone this request to tomorrow so it doesn't starve other users in queue.
        const tomorrow = this.mailQuota.getStartOfTomorrow(now);
        await this.requests.updateOne(
          { _id: doc._id },
          { $set: { nextAttemptAt: tomorrow }, $unset: { lockedUntil: 1 } },
        );
        continue;
      }

      claimedPerUser.set(userIdStr, userInBatch + 1);
      claimed.push(doc);
    }
    return claimed;
  }

  /** Handles the outcome of a send attempt: retry with backoff, then hand over to the user. */
  async deliverClaimed(req: RequestDoc): Promise<'sent' | 'retry' | 'failed'> {
    // The user may have cancelled or revoked between claim and send.
    if (!(await this.requests.exists({ _id: req._id, status: 'queued' }))) return 'failed';
    try {
      await this.sendInitial(req);
      req.lockedUntil = undefined;
      await req.save();
      await this.mailQuota.recordUserSend(req.userId);
      return 'sent';
    } catch (err) {
      if (err instanceof SenderAuthError) {
        await this.markSenderError(req.profileId, err.message);
        req.lockedUntil = undefined;
        req.lastError = err.message.slice(0, 300);
        req.nextAttemptAt = new Date(this.clock.now().getTime() + 60 * 60 * 1000);
        await req.save();
        return 'retry';
      }
      const transient = err instanceof MailError ? err.transient : true;
      req.attempts += 1;
      req.lastError = (err as Error).message.slice(0, 300);
      req.lockedUntil = undefined;
      if (transient && req.attempts < MAX_SEND_ATTEMPTS) {
        req.nextAttemptAt = new Date(this.clock.now().getTime() + Math.pow(2, req.attempts) * 60 * 1000);
        await req.save();
        this.logger.warn(`send failed (attempt ${req.attempts}) for ${req.shortRef}: ${req.lastError}`);
        return 'retry';
      }
      req.nextAttemptAt = undefined;
      this.timeline(req, 'note', undefined, `Invio automatico non riuscito: ${req.lastError}`);
      this.transition(req, 'action_required', { reason: 'manual_steps' });
      const broker = req.custom ? null : await this.brokers.getRaw(req.brokerKey);
      const plan = broker ? planChannel(broker) : null;
      req.manual = plan?.manual ?? { steps: ["Invia la richiesta al titolare con i tuoi mezzi usando il testo qui sotto."], email: this.recipient(req) };
      req.channel = 'manual';
      await req.save();
      await this.notifications.notify(req.userId, {
        type: 'action_required',
        title: `Azione richiesta: ${req.brokerName}`,
        body: "Non siamo riusciti a inviare la richiesta in automatico. Puoi inviarla tu seguendo le istruzioni.",
        requestId: req._id,
        appPath: `/app/richieste/${String(req._id)}`,
      });
      this.logger.error(`send permanently failed for ${req.shortRef}: ${req.lastError}`);
      return 'failed';
    }
  }

  /** sent/replied past the deadline become overdue. Returns the requests changed. */
  async markOverdue(): Promise<RequestDoc[]> {
    const now = this.clock.now();
    const due = await this.requests.find({ status: { $in: ['sent', 'replied'] }, dueAt: { $lte: now } }).limit(200);
    const changed: RequestDoc[] = [];
    for (const req of due) {
      const claimed = await this.requests.findOneAndUpdate({ _id: req._id, status: req.status }, { $set: { status: 'overdue' } });
      if (!claimed) continue;
      const fresh = await this.requests.findById(req._id);
      if (!fresh) continue;
      fresh.status = 'overdue';
      this.timeline(fresh, 'status_changed', 'overdue', 'Termine di 30 giorni scaduto');
      await fresh.save();
      changed.push(fresh);
      await this.notifications.notify(fresh.userId, {
        type: 'request_status',
        title: `${fresh.brokerName}: nessuna risposta entro il termine`,
        body: `Il termine di ${this.config.responseDeadlineDays} giorni è scaduto. ${fresh.channel === 'email' ? 'Inviamo un sollecito automatico.' : 'Puoi sollecitare il titolare o preparare un reclamo al Garante.'}`,
        requestId: fresh._id,
        appPath: `/app/richieste/${String(fresh._id)}`,
      });
    }
    return changed;
  }

  /** Automatic reminders for overdue email requests (max 2, spaced by REMINDER_INTERVAL_DAYS). */
  async sendDueReminders(limit: number): Promise<number> {
    const globalCheck = await this.mailQuota.canSendGlobal(this.config.mailMode, false);
    if (!globalCheck.allowed) {
      this.logger.warn(`sendDueReminders: ${globalCheck.reason}. Sospensione solleciti.`);
      return 0;
    }
    const now = this.clock.now();
    const threshold = addDays(now, -this.config.reminderIntervalDays);
    const candidates = await this.requests
      .find({ status: 'overdue', channel: 'email', reminderCount: { $lt: MAX_REMINDERS }, lastOutgoingAt: { $lte: threshold } })
      .limit(limit);
    let sent = 0;
    for (const req of candidates) {
      const profile = await this.profiles.findById(req.profileId).select('status senderError').lean();
      if (profile?.status !== 'active' || profile.senderError) continue;
      try {
        await this.sendReminder(req);
        await this.mailQuota.recordUserSend(req.userId);
        sent += 1;
      } catch (err) {
        if (err instanceof SenderAuthError) await this.markSenderError(req.profileId, err.message);
        this.logger.warn(`reminder failed for ${req.shortRef}: ${(err as Error).message}`);
      }
    }
    return sent;
  }

  /** Completed requests whose check date has passed get a new cycle. */
  async createRenewals(limit: number): Promise<number> {
    const now = this.clock.now();
    const due = await this.requests.find({ status: 'completed', kind: { $ne: 'access' }, nextCheckAt: { $lte: now }, renewedAt: { $exists: false } }).limit(limit);
    let created = 0;
    for (const old of due) {
      const profile = await this.profiles.findById(old.profileId);
      const claimed = await this.requests.findOneAndUpdate(
        { _id: old._id, renewedAt: { $exists: false } },
        { $set: { renewedAt: now }, $unset: { nextCheckAt: 1 } },
      );
      if (!claimed) continue;
      if (!profile || profile.status !== 'active') continue;
      let plan: ChannelPlan | null;
      let websiteSpec: NewRequestSpec['custom'];
      if (old.custom) {
        websiteSpec = old.custom;
        plan = old.custom.contactEmail
          ? { channel: 'email', email: old.custom.contactEmail }
          : { channel: 'manual', actionReason: 'manual_steps', manual: old.manual ?? { steps: [] } };
      } else {
        const broker = await this.brokers.getRaw(old.brokerKey);
        if (!broker || !broker.sendEnabled) continue;
        plan = planChannel(broker);
      }
      if (!plan) continue;
      const next = await this.createRequest(profile, {
        brokerKey: old.brokerKey,
        brokerName: old.brokerName,
        brokerWebsite: old.brokerWebsite,
        brokerCategory: old.brokerCategory,
        plan,
        cycle: old.cycle + 1,
        custom: websiteSpec,
      });
      if (next) {
        created += 1;
        const o = await this.requests.findById(old._id);
        if (o) {
          this.timeline(o, 'renewed', undefined, `Nuova richiesta ${next.shortRef} (ciclo ${next.cycle})`);
          await o.save();
        }
        await this.notifications.notify(old.userId, {
          type: 'request_status',
          title: `${old.brokerName}: nuova verifica avviata`,
          body: `Sono passati ${this.config.renewalDays} giorni: abbiamo avviato una nuova richiesta per verificare che i dati non siano stati raccolti di nuovo.`,
          requestId: next._id,
          appPath: `/app/richieste/${String(next._id)}`,
        });
      }
    }
    return created;
  }

  /** Creates requests for sendable brokers that active profiles do not have yet (e.g. newly enabled ones). */
  async syncNewBrokers(profileLimit: number): Promise<number> {
    const sendable = await this.brokers.sendableBrokers();
    if (!sendable.length) return 0;
    const profiles = await this.profiles.find({ status: 'active' }).sort({ _id: 1 }).limit(profileLimit);
    let created = 0;
    const now = this.clock.now();
    for (const profile of profiles) {
      // The same matching as at activation: a broker that is not relevant to this profile is not added later either.
      const { brokers } = selectBrokersForProfile(sendable, profileCountries(this.data.pii(profile).addresses), this.config.brokerRelevance);
      const existing = new Set((await this.requests.find({ profileId: profile._id, kind: { $ne: 'access' }, cycle: { $gte: 1 } }).distinct('brokerKey')) as string[]);
      const queuedCount = await this.requests.countDocuments({ profileId: profile._id, status: 'queued', channel: 'email' });
      let emailOffset = queuedCount;
      for (const b of brokers) {
        if (existing.has(b.slug)) continue;
        const plan = planChannel(b);
        if (!plan) continue;
        const dayOffset = plan.channel === 'email' ? Math.floor(emailOffset / this.config.userDailyRequestLimit) : 0;
        const scheduledAt = dayOffset === 0 ? now : addDays(now, dayOffset);
        const doc = await this.createRequest(profile, {
          brokerKey: b.slug,
          brokerName: b.name,
          brokerWebsite: b.website,
          brokerCategory: b.category,
          plan,
          cycle: 1,
          scheduledAt,
        });
        if (doc) {
          created += 1;
          if (plan.channel === 'email') emailOffset += 1;
        }
      }
    }
    return created;
  }

  /** Delega revoked: pending requests are cancelled but remembered so they can be revived on re-activation. */
  async cancelQueuedForProfile(profileId: Types.ObjectId): Promise<void> {
    const pending = await this.requests.find({ profileId, status: { $in: ['queued', 'action_required'] } });
    for (const r of pending) {
      r.status = 'cancelled';
      r.actionReason = undefined;
      r.nextAttemptAt = undefined;
      r.suspendedAt = this.clock.now();
      this.timeline(r, 'status_changed', 'cancelled', 'Delega revocata');
      await r.save();
    }
  }

  /** Re-activation after a revoked delega: brings back the requests that were never sent. */
  async reviveSuspended(profileId: Types.ObjectId): Promise<{ email: number; manual: number }> {
    const suspended = await this.requests.find({ profileId, status: 'cancelled', suspendedAt: { $exists: true } });
    let email = 0;
    let manual = 0;
    const now = this.clock.now();
    for (const r of suspended) {
      const isEmail = r.channel === 'email';
      const dayOffset = isEmail ? Math.floor(email / this.config.userDailyRequestLimit) : 0;
      r.status = isEmail ? 'queued' : 'action_required';
      r.actionReason = isEmail ? undefined : (r.actionReason ?? 'manual_steps');
      r.nextAttemptAt = isEmail ? (dayOffset === 0 ? now : addDays(now, dayOffset)) : undefined;
      r.suspendedAt = undefined;
      this.timeline(r, 'status_changed', r.status, 'Profilo riattivato');
      await r.save();
      if (isEmail) email += 1;
      else manual += 1;
    }
    return { email, manual };
  }
}
