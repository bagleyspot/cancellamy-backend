import { Module } from '@nestjs/common';
import { AdminController } from './admin/admin.controller';
import { BreachesController } from './breaches/breaches.controller';
import { BreachesService } from './breaches/breaches.service';
import { DelistingsController } from './delistings/delistings.controller';
import { DelistingsService } from './delistings/delistings.service';
import { DossierService } from './dossier/dossier.service';
import { TimestampService } from './dossier/timestamp.service';
import { IdentityController } from './identity/identity.controller';
import { IdentityService } from './identity/identity.service';
import { SmsService } from './identity/sms.service';
import { NuisanceController } from './nuisance/nuisance.controller';
import { NuisanceService } from './nuisance/nuisance.service';
import { OutboundService } from './sender/outbound.service';
import { GmailSenderService } from './sender/gmail-sender.service';
import { GmailAuthController, SenderController } from './sender/sender.controller';
import { SenderService } from './sender/sender.service';
import { SmtpSenderService } from './sender/smtp-sender.service';
import { InboundController } from './inbound/inbound.controller';
import { InboundService } from './inbound/inbound.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { PdfService } from './pdf/pdf.service';
import { ProfileDataService } from './profiles/profile-data.service';
import { ProfilesController } from './profiles/profiles.controller';
import { ProfilesService } from './profiles/profiles.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { DataMapController } from './requests/data-map.controller';
import { RequestEngine } from './requests/request-engine';
import { DispatchQueueService } from './queue/dispatch-queue.service';
import { RequestsController } from './requests/requests.controller';
import { RequestsService } from './requests/requests.service';
import { InternalController } from './scheduler/internal.controller';
import { SchedulerService } from './scheduler/scheduler.service';

@Module({
  controllers: [
    ProfilesController,
    RequestsController,
    NotificationsController,
    ReportsController,
    AdminController,
    InboundController,
    InternalController,
    SenderController,
    GmailAuthController,
    IdentityController,
    BreachesController,
    DelistingsController,
    NuisanceController,
    DataMapController,
  ],
  providers: [
    PdfService,
    ProfileDataService,
    ProfilesService,
    RequestEngine,
    DispatchQueueService,
    RequestsService,
    NotificationsService,
    ReportsService,
    InboundService,
    SchedulerService,
    SmtpSenderService,
    GmailSenderService,
    OutboundService,
    SenderService,
    SmsService,
    IdentityService,
    TimestampService,
    DossierService,
    BreachesService,
    DelistingsService,
    NuisanceService,
  ],
  exports: [SchedulerService, RequestEngine, InboundService, ProfilesService],
})
export class DomainModule {}
