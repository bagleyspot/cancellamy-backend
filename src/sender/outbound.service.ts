import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Profile } from '../db/schemas';
import { CryptoService } from '../common/crypto.service';
import { MailService } from '../mail/mail.service';
import { MailMessage, SendResult } from '../mail/mail.types';
import { GmailSenderService, GmailSettings } from './gmail-sender.service';
import { SenderAuthError, SmtpSenderService, SmtpSettings } from './smtp-sender.service';

export type Via = 'resend' | 'smtp' | 'gmail' | 'dry-run';
type SenderProfile = Pick<Profile, 'senderMode' | 'smtpEnc' | 'gmailEnc'>;

/** Chooses how an email of a profile leaves the system: Cancellamy's provider or the user's own mailbox. */
@Injectable()
export class OutboundService {
  constructor(
    private readonly mail: MailService,
    private readonly smtp: SmtpSenderService,
    private readonly gmailSender: GmailSenderService,
    private readonly crypto: CryptoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  settings(profile: SenderProfile): SmtpSettings | null {
    if (profile.senderMode !== 'smtp' || !profile.smtpEnc) return null;
    return this.crypto.decryptJson<SmtpSettings>(profile.smtpEnc);
  }

  gmail(profile: SenderProfile): GmailSettings | null {
    if (profile.senderMode !== 'gmail' || !profile.gmailEnc) return null;
    return this.crypto.decryptJson<GmailSettings>(profile.gmailEnc);
  }

  /** The From header for a profile. */
  from(profile: SenderProfile, fullName: string): string {
    const clean = (s: string) => s.replace(/["<>\\\r\n]/g, '');
    const smtp = this.settings(profile);
    if (smtp) return `"${clean(fullName)}" <${smtp.fromAddress}>`;
    const gmail = this.gmail(profile);
    if (gmail) return `"${clean(fullName)}" <${gmail.email}>`;
    const m = /<([^>]+)>/.exec(this.config.mailFrom);
    return `Cancellamy per conto di ${clean(fullName)} <${m?.[1] ?? this.config.mailFrom}>`;
  }

  /**
   * In mailbox mode replies must reach the user directly (there is no inbound domain), and, while trying the flow, the
   * email goes to MAIL_REDIRECT_TO instead of the broker, with the real recipients written in the subject and a header.
   */
  private forMailbox(message: MailMessage): MailMessage {
    const { replyTo: _alias, ...rest } = message;
    const redirect = this.config.mailRedirectTo;
    if (!redirect) return rest;
    const original = message.to.join(', ');
    return {
      ...rest,
      to: [redirect],
      subject: `[TEST -> ${original}] ${message.subject}`,
      headers: { ...message.headers, 'X-Original-To': original },
    };
  }

  async send(profile: SenderProfile, message: MailMessage): Promise<SendResult & { via: Via }> {
    const gmail = this.gmail(profile);
    const smtp = gmail ? null : this.settings(profile);
    if ((gmail || smtp) && this.config.mailMode === 'dry-run') {
      // Dry-run never talks to Google or to anyone's mail server.
      return { id: `dry_${randomUUID()}`, dryRun: true, via: 'dry-run' };
    }
    if (this.config.mailMode === 'mailbox') {
      if (!gmail && !smtp) {
        // Nothing is sent "from Cancellamy" here: the requests wait until the user connects a mailbox.
        throw new SenderAuthError('This instance only sends from your own mailbox: connect SMTP or Gmail in the profile settings');
      }
      const out = this.forMailbox(message);
      return gmail ? { ...(await this.gmailSender.send(gmail, out)), via: 'gmail' } : { ...(await this.smtp.send(smtp as SmtpSettings, out)), via: 'smtp' };
    }
    if (gmail) return { ...(await this.gmailSender.send(gmail, message)), via: 'gmail' };
    if (smtp) return { ...(await this.smtp.send(smtp, message)), via: 'smtp' };
    const res = await this.mail.send(message);
    return { ...res, via: res.dryRun ? 'dry-run' : 'resend' };
  }
}
