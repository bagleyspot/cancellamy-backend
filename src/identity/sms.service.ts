import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { CodedException } from '../common/errors';

/** SMS delivery for verification codes. `dry-run` only logs (debug level); `twilio` really sends. */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return this.config.smsProvider !== 'none';
  }

  async send(to: string, text: string): Promise<void> {
    if (this.config.smsProvider === 'none') {
      throw new CodedException(404, 'SMS verification is not available on this instance', 'FEATURE_DISABLED');
    }
    if (this.config.smsProvider === 'dry-run') {
      this.logger.log('dry-run sms recorded');
      this.logger.debug(`dry-run sms to=${to}: ${text}`);
      return;
    }
    const { twilioAccountSid: sid, twilioAuthToken: token, twilioFrom: from } = this.config;
    const body = new URLSearchParams({ To: to, From: from, Body: text });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new ServiceUnavailableException(`SMS provider error (${res.status})`);
  }
}
