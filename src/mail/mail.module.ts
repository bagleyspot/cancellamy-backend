import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { MAIL_TRANSPORT } from './mail.types';
import { MailService } from './mail.service';
import { DryRunTransport, ResendTransport } from './transports';
import { MailQuotaService } from './mail-quota.service';

@Global()
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.mailMode === 'resend' ? new ResendTransport(config.resendApiKey) : new DryRunTransport(),
    },
    MailQuotaService,
    MailService,
  ],
  exports: [MailService, MailQuotaService, MAIL_TRANSPORT],
})
export class MailModule {}
