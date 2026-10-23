export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailMessage {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: MailAttachment[];
  /** Same key => the provider will not deliver the email twice (24h on Resend). */
  idempotencyKey?: string;
  tags?: { name: string; value: string }[];
}

export interface SendResult {
  id: string;
  dryRun: boolean;
}

export interface MailTransport {
  readonly dryRun: boolean;
  send(message: MailMessage): Promise<SendResult>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Thrown by transports; `transient` errors may be retried later. */
export class MailError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = 'MailError';
  }
}
