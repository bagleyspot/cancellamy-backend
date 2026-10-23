import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { MAIL_TRANSPORT, MailError, MailMessage, MailTransport, SendResult } from './mail.types';
import { renderHtml } from './html';
import { MailQuotaService } from './mail-quota.service';

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    private readonly quota: MailQuotaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get dryRun(): boolean {
    return this.transport.dryRun;
  }

  async send(message: MailMessage, opts: { isSystem?: boolean } = {}): Promise<SendResult> {
    if (!this.dryRun) {
      const check = await this.quota.canSendGlobal('resend', opts.isSystem ?? false);
      if (!check.allowed) {
        throw new MailError(check.reason ?? 'Resend quota reached', true);
      }
    }
    const res = await this.transport.send(message);
    if (!this.dryRun && !res.dryRun) {
      await this.quota.recordGlobalSend('resend');
    }
    return res;
  }

  /** Sends a system email (verification, notification...) from the configured sender. */
  sendSystem(opts: {
    to: string;
    subject: string;
    paragraphs: string[];
    button?: { label: string; url: string };
    idempotencyKey?: string;
  }): Promise<SendResult> {
    const text = [...opts.paragraphs, ...(opts.button ? ['', `${opts.button.label}: ${opts.button.url}`] : [])].join('\n\n');
    return this.send(
      {
        from: this.config.mailFrom,
        to: [opts.to],
        subject: opts.subject,
        text,
        html: renderHtml(opts.subject, opts.paragraphs, opts.button),
        idempotencyKey: opts.idempotencyKey,
      },
      { isSystem: true },
    );
  }
}
