import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Resend } from 'resend';
import { MailError, MailMessage, MailTransport, SendResult } from './mail.types';

/** Records nothing and sends nothing: the caller persists the message; used by default and in tests. */
export class DryRunTransport implements MailTransport {
  readonly dryRun = true;
  private readonly logger = new Logger('MailDryRun');

  async send(message: MailMessage): Promise<SendResult> {
    // The subject carries the user's name: it is only logged at debug level.
    this.logger.log(`dry-run email to=${message.to.join(',')} attachments=${message.attachments?.length ?? 0}`);
    this.logger.debug(`dry-run email subject: ${message.subject}`);
    // Developers need the verification / reset links: the body is logged at debug level only (never in production logs).
    this.logger.debug(`dry-run email body:\n${message.text}`);
    return { id: `dry_${randomUUID()}`, dryRun: true };
  }
}

interface ResendLikeError {
  name?: string;
  message?: string;
  statusCode?: number | null;
}

export class ResendTransport implements MailTransport {
  readonly dryRun = false;
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(message: MailMessage): Promise<SendResult> {
    let response;
    try {
      response = await this.client.emails.send(
        {
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          ...(message.headers ? { headers: message.headers } : {}),
          ...(message.tags ? { tags: message.tags } : {}),
          ...(message.attachments?.length
            ? {
                attachments: message.attachments.map((a) => ({
                  filename: a.filename,
                  content: a.content,
                  ...(a.contentType ? { contentType: a.contentType } : {}),
                })),
              }
            : {}),
        },
        message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined,
      );
    } catch (err) {
      throw new MailError(`Resend network error: ${(err as Error).message}`, true);
    }
    const error = response.error as ResendLikeError | null;
    if (error) {
      const status = error.statusCode ?? 0;
      const transient = status === 429 || status >= 500 || status === 0 || error.name === 'rate_limit_exceeded';
      throw new MailError(`Resend error ${status} ${error.name ?? ''}: ${error.message ?? ''}`.trim(), transient);
    }
    if (!response.data?.id) throw new MailError('Resend returned no message id', true);
    return { id: response.data.id, dryRun: false };
  }
}
