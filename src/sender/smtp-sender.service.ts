import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createTransport } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { MailError, MailMessage, SendResult } from '../mail/mail.types';
import { HostNotAllowedError, resolvePublicHost } from './net-guard';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
}

export const ALLOWED_SMTP_PORTS = [25, 465, 587, 2525];

/** The user's mailbox rejected our credentials or refuses the sender: nothing else will work until fixed. */
export class SenderAuthError extends MailError {
  constructor(message: string) {
    super(message, false);
    this.name = 'SenderAuthError';
  }
}

export class SmtpConfigError extends Error {
  constructor(
    message: string,
    readonly code: 'SMTP_CONNECTION_FAILED' | 'SMTP_HOST_NOT_ALLOWED',
  ) {
    super(message);
  }
}

interface NodemailerError extends Error {
  code?: string;
  responseCode?: number;
  command?: string;
}

@Injectable()
export class SmtpSenderService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private async transport(s: SmtpSettings) {
    const dev = this.config.smtpAllowPrivateHosts;
    if (!dev && !ALLOWED_SMTP_PORTS.includes(s.port)) {
      throw new SmtpConfigError(`Port ${s.port} is not allowed (use 25, 465, 587 or 2525)`, 'SMTP_HOST_NOT_ALLOWED');
    }
    let address = s.host.trim();
    if (!dev) {
      try {
        address = await resolvePublicHost(s.host);
      } catch (err) {
        if (err instanceof HostNotAllowedError) throw new SmtpConfigError(err.message, 'SMTP_HOST_NOT_ALLOWED');
        throw err;
      }
    }
    const options: SMTPTransport.Options = {
      host: address,
      port: s.port,
      secure: s.secure,
      auth: { user: s.username, pass: s.password },
      requireTLS: !s.secure && !dev,
      tls: { servername: s.host.trim(), rejectUnauthorized: !dev },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    };
    return createTransport(options);
  }

  /** Connection + authentication test. Nothing is sent. Throws SmtpConfigError with a friendly message. */
  async verify(settings: SmtpSettings): Promise<void> {
    const transport = await this.transport(settings);
    try {
      await transport.verify();
    } catch (err) {
      throw new SmtpConfigError(this.explain(err as NodemailerError, settings), 'SMTP_CONNECTION_FAILED');
    } finally {
      transport.close();
    }
  }

  async send(settings: SmtpSettings, message: MailMessage): Promise<SendResult> {
    let transport;
    try {
      transport = await this.transport(settings);
    } catch (err) {
      if (err instanceof SmtpConfigError) throw new SenderAuthError(err.message);
      throw err;
    }
    try {
      const domain = settings.fromAddress.split('@')[1] ?? 'localhost';
      const info = await transport.sendMail({
        from: message.from,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        headers: message.headers,
        messageId: `<${randomUUID()}@${domain}>`,
        attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      });
      return { id: info.messageId, dryRun: false };
    } catch (err) {
      throw this.classify(err as NodemailerError);
    } finally {
      transport.close();
    }
  }

  private classify(err: NodemailerError): MailError {
    const rc = err.responseCode ?? 0;
    if (err.code === 'EAUTH' || [530, 534, 535, 538].includes(rc)) {
      return new SenderAuthError('Your mailbox rejected the credentials (use an app password and check the username)');
    }
    if (rc >= 500 && err.command === 'MAIL FROM') {
      return new SenderAuthError('Your mail provider does not allow sending from this address');
    }
    const transientCodes = ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNRESET', 'ECONNREFUSED'];
    if (rc >= 400 && rc < 500) return new MailError(`SMTP ${rc}: ${err.message}`, true);
    if (err.code && transientCodes.includes(err.code)) return new MailError(`SMTP connection problem: ${err.message}`, true);
    if (rc >= 500) return new MailError(`SMTP ${rc}: ${err.message}`, false);
    return new MailError(`SMTP error: ${err.message}`, true);
  }

  private explain(err: NodemailerError, s: SmtpSettings): string {
    const rc = err.responseCode ?? 0;
    if (err.code === 'EAUTH' || [530, 534, 535, 538].includes(rc)) {
      return 'Credenziali non accettate: controlla utente e password (molti provider richiedono una password per app).';
    }
    if (err.code === 'ETLS' || /certificate|self.signed|tls|starttls/i.test(err.message)) {
      return 'Impossibile stabilire una connessione sicura (TLS): controlla porta e opzione "connessione sicura".';
    }
    if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'EDNS'].includes(err.code ?? '')) {
      return `Impossibile connettersi a ${s.host}:${s.port}: controlla server e porta.`;
    }
    return `Connessione al server di posta non riuscita (${err.code ?? 'errore'}).`;
  }
}
