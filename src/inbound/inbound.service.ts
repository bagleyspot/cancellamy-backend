import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Webhook } from 'standardwebhooks';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import {
  Message,
  MessageDoc,
  ProcessedWebhook,
  ProcessedWebhookDoc,
  Profile,
  ProfileDoc,
  RemovalRequest,
  RequestDoc,
  UnmatchedInbound,
  UnmatchedInboundDoc,
} from '../db/schemas';
import { Clock } from '../common/clock';
import { CryptoService } from '../common/crypto.service';
import { BrokersService } from '../brokers/brokers.service';
import { IncomingAttachment, RequestEngine } from '../requests/request-engine';

export interface InboundEmail {
  providerEmailId: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  receivedAt: Date;
  attachments: IncomingAttachment[];
  /** SPF/DKIM/DMARC verdict when the provider supplies it. */
  dmarc?: string;
}

interface ResendReceivedEmail {
  id?: string;
  from?: string;
  to?: string[];
  subject?: string;
  text?: string | null;
  html?: string | null;
  created_at?: string;
  attachments?: { filename?: string; content_type?: string; size?: number }[];
  authentication?: { dmarc?: { result?: string } | string };
}

const REF_RE = /CNC-[23456789A-HJ-NP-Z]{8}/i;

function domainOf(address: string): string {
  const m = /@([^>\s]+)/.exec(address);
  return (m?.[1] ?? '').toLowerCase();
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    @InjectModel(Profile.name) private readonly profiles: Model<ProfileDoc>,
    @InjectModel(RemovalRequest.name) private readonly requests: Model<RequestDoc>,
    @InjectModel(Message.name) private readonly messages: Model<MessageDoc>,
    @InjectModel(UnmatchedInbound.name) private readonly unmatched: Model<UnmatchedInboundDoc>,
    @InjectModel(ProcessedWebhook.name) private readonly processed: Model<ProcessedWebhookDoc>,
    private readonly engine: RequestEngine,
    private readonly brokers: BrokersService,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Verifies a Resend (Svix) webhook and processes `email.received`. */
  async handleResendWebhook(rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>): Promise<void> {
    if (!this.config.resendWebhookSecret) throw new ServiceUnavailableException('Inbound webhook is not configured');
    if (!rawBody) throw new BadRequestException('Missing body');
    const h = (k: string) => (Array.isArray(headers[k]) ? (headers[k] as string[])[0] : (headers[k] as string | undefined)) ?? '';
    let event: { type?: string; data?: { email_id?: string } };
    try {
      event = new Webhook(this.config.resendWebhookSecret).verify(rawBody.toString('utf8'), {
        'webhook-id': h('svix-id'),
        'webhook-timestamp': h('svix-timestamp'),
        'webhook-signature': h('svix-signature'),
      }) as unknown as typeof event;
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }
    if (event.type !== 'email.received' || !event.data?.email_id) return;
    try {
      await this.processed.create({ webhookId: h('svix-id') });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return; // already handled (retry)
      throw err;
    }
    try {
      const email = await this.fetchReceived(event.data.email_id);
      await this.processInbound(email);
    } catch (err) {
      // Let Resend retry: forget that we processed this delivery.
      await this.processed.deleteOne({ webhookId: h('svix-id') });
      throw err;
    }
  }

  private async fetchReceived(emailId: string): Promise<InboundEmail> {
    const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${this.config.resendApiKey}` },
    });
    if (!res.ok) throw new ServiceUnavailableException(`Could not fetch received email (${res.status})`);
    const body = (await res.json()) as ResendReceivedEmail;
    const dmarcRaw = body.authentication?.dmarc;
    const attachments = (body.attachments ?? []).length ? await this.fetchAttachments(emailId) : [];
    return {
      providerEmailId: body.id ?? emailId,
      from: body.from ?? '',
      to: body.to ?? [],
      subject: body.subject ?? '',
      text: (body.text ?? (body.html ? htmlToText(body.html) : '')).slice(0, 20000),
      receivedAt: body.created_at ? new Date(body.created_at) : this.clock.now(),
      attachments,
      dmarc: typeof dmarcRaw === 'string' ? dmarcRaw : dmarcRaw?.result,
    };
  }

  /** Downloads the files of a received email (bounded: a few files, size-limited) so the user can read them later. */
  private async fetchAttachments(emailId: string): Promise<IncomingAttachment[]> {
    const out: IncomingAttachment[] = [];
    try {
      const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments`, {
        headers: { Authorization: `Bearer ${this.config.resendApiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return out;
      const list = (await res.json()) as { data?: { filename?: string; content_type?: string; size?: number; download_url?: string }[] };
      for (const a of (list.data ?? []).slice(0, 5)) {
        const meta: IncomingAttachment = { filename: (a.filename ?? 'allegato').slice(0, 120), contentType: a.content_type ?? 'application/octet-stream', size: a.size };
        if (a.download_url && /^https:\/\//.test(a.download_url) && (a.size ?? 0) <= this.config.maxAttachmentBytes) {
          try {
            const file = await fetch(a.download_url, { signal: AbortSignal.timeout(20_000) });
            if (file.ok) {
              const buf = Buffer.from(await file.arrayBuffer());
              if (buf.length <= this.config.maxAttachmentBytes) meta.content = buf;
            }
          } catch (err) {
            this.logger.warn(`attachment download failed: ${(err as Error).message}`);
          }
        }
        out.push(meta);
      }
    } catch (err) {
      this.logger.warn(`attachment listing failed: ${(err as Error).message}`);
    }
    return out;
  }

  /** Matches an inbound email to a request (by reply address, reference code, sender domain). */
  async processInbound(email: InboundEmail): Promise<{ matched: boolean; requestId?: string }> {
    if (await this.messages.exists({ providerId: email.providerEmailId })) return { matched: true };
    const token = this.replyToken(email.to);
    const profile = token ? await this.profiles.findOne({ replyToken: token }) : null;
    const req = profile && email.dmarc !== 'fail' ? await this.findRequest(profile, email) : null;
    if (!req) {
      await this.storeUnmatched(email);
      return { matched: false };
    }
    await this.engine.applyReply(req, {
      from: email.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      at: email.receivedAt,
      providerId: email.providerEmailId,
      dryRun: false,
      attachments: email.attachments,
    });
    return { matched: true, requestId: String(req._id) };
  }

  private replyToken(to: string[]): string | null {
    for (const addr of to) {
      const m = /(?:^|<)r-([a-z0-9]+)@([^>\s]+)>?$/i.exec(addr.trim());
      if (m && m[2]?.toLowerCase() === this.config.inboundDomain.toLowerCase()) return (m[1] as string).toLowerCase();
    }
    return null;
  }

  private async findRequest(profile: ProfileDoc, email: InboundEmail): Promise<RequestDoc | null> {
    const ref = REF_RE.exec(email.subject)?.[0] ?? REF_RE.exec(email.text)?.[0];
    if (ref) {
      const byRef = await this.requests.findOne({ profileId: profile._id, shortRef: ref.toUpperCase() });
      if (byRef) return byRef;
    }
    const fromDomain = domainOf(email.from);
    if (!fromDomain) return null;
    const open = await this.requests
      .find({ profileId: profile._id, channel: 'email', status: { $in: ['sent', 'replied', 'overdue', 'escalated', 'action_required'] } })
      .sort({ lastOutgoingAt: -1 })
      .limit(200);
    const candidates: RequestDoc[] = [];
    for (const r of open) {
      let d = r.custom?.contactEmail ? domainOf(r.custom.contactEmail) : '';
      if (!d && !r.custom) d = (await this.brokers.getRaw(r.brokerKey))?.domain ?? '';
      if (d && (fromDomain === d || fromDomain.endsWith(`.${d}`))) candidates.push(r);
    }
    return candidates.length === 1 ? (candidates[0] as RequestDoc) : null;
  }

  private async storeUnmatched(email: InboundEmail): Promise<void> {
    try {
      await this.unmatched.create({
        receivedAt: email.receivedAt,
        from: email.from,
        to: email.to,
        subjectEnc: this.crypto.encrypt(email.subject),
        textEnc: this.crypto.encrypt(email.text),
        providerEmailId: email.providerEmailId,
      });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }

  // ------------------------------------------------------------------ admin
  async listUnmatched() {
    const items = await this.unmatched.find().sort({ receivedAt: -1 }).limit(200);
    return items.map((u) => ({
      id: String(u._id),
      receivedAt: u.receivedAt.toISOString(),
      from: u.from,
      to: u.to,
      subject: this.crypto.decrypt(u.subjectEnc),
      text: this.crypto.decrypt(u.textEnc),
      assignedRequestId: u.assignedRequestId ? String(u.assignedRequestId) : null,
    }));
  }

  async assign(unmatchedId: string, requestId: string): Promise<void> {
    const u = await this.unmatched.findById(unmatchedId);
    if (!u) throw new NotFoundException('Unmatched message not found');
    if (u.assignedRequestId) throw new BadRequestException('Already assigned');
    // Admins may paste either the internal id or the CNC-XXXXXXXX reference printed in the emails.
    const req = /^CNC-/i.test(requestId)
      ? await this.requests.findOne({ shortRef: requestId.toUpperCase() })
      : /^[a-f0-9]{24}$/i.test(requestId)
        ? await this.requests.findById(requestId)
        : null;
    if (!req) throw new NotFoundException('Request not found');
    await this.engine.applyReply(req, {
      from: u.from,
      to: u.to,
      subject: this.crypto.decrypt(u.subjectEnc),
      text: this.crypto.decrypt(u.textEnc),
      at: u.receivedAt,
      providerId: u.providerEmailId,
      dryRun: false,
    });
    u.assignedRequestId = req._id;
    await u.save();
  }

  countUnmatched(): Promise<number> {
    return this.unmatched.countDocuments({ assignedRequestId: { $exists: false } });
  }
}
