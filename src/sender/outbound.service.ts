import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Profile } from '../db/schemas';
import { CryptoService } from '../common/crypto.service';
import { MailService } from '../mail/mail.service';
import { MailMessage, SendResult } from '../mail/mail.types';
import { SmtpSenderService, SmtpSettings } from './smtp-sender.service';

export type Via = 'resend' | 'smtp' | 'dry-run';

/** Chooses how an email of a profile leaves the system: Cancellamy's provider or the user's own mailbox. */
@Injectable()
export class OutboundService {
  constructor(
    private readonly mail: MailService,
    private readonly smtp: SmtpSenderService,
    private readonly crypto: CryptoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  settings(profile: Pick<Profile, 'senderMode' | 'smtpEnc'>): SmtpSettings | null {
    if (profile.senderMode !== 'smtp' || !profile.smtpEnc) return null;
    return this.crypto.decryptJson<SmtpSettings>(profile.smtpEnc);
  }

  /** The From header for a profile. */
  from(profile: Pick<Profile, 'senderMode' | 'smtpEnc'>, fullName: string): string {
    const clean = (s: string) => s.replace(/["<>\\\r\n]/g, '');
    const smtp = this.settings(profile);
    if (smtp) return `"${clean(fullName)}" <${smtp.fromAddress}>`;
    const m = /<([^>]+)>/.exec(this.config.mailFrom);
    return `Cancellamy per conto di ${clean(fullName)} <${m?.[1] ?? this.config.mailFrom}>`;
  }

  async send(profile: Pick<Profile, 'senderMode' | 'smtpEnc'>, message: MailMessage): Promise<SendResult & { via: Via }> {
    const smtp = this.settings(profile);
    if (smtp) {
      // Dry-run never talks to anyone's mail server.
      if (this.config.mailMode === 'dry-run') return { id: `dry_${randomUUID()}`, dryRun: true, via: 'dry-run' };
      return { ...(await this.smtp.send(smtp, message)), via: 'smtp' };
    }
    const res = await this.mail.send(message);
    return { ...res, via: res.dryRun ? 'dry-run' : 'resend' };
  }
}
