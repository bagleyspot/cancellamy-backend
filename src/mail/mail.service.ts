import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { MAIL_TRANSPORT, MailMessage, MailTransport, SendResult } from './mail.types';
import { renderHtml } from './html';

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get dryRun(): boolean {
    return this.transport.dryRun;
  }

  send(message: MailMessage): Promise<SendResult> {
    return this.transport.send(message);
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
    return this.send({
      from: this.config.mailFrom,
      to: [opts.to],
      subject: opts.subject,
      text,
      html: renderHtml(opts.subject, opts.paragraphs, opts.button),
      idempotencyKey: opts.idempotencyKey,
    });
  }
}
