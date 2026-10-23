import { Global, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Clock } from '../common/clock';
import { CryptoService } from '../common/crypto.service';
import {
  Authorization,
  AuthorizationModel,
  Broker,
  BrokerModel,
  Lock,
  LockModel,
  Message,
  MessageModel,
  Notification,
  NotificationModel,
  ProcessedWebhook,
  ProcessedWebhookModel,
  RemovalRequest,
  RemovalRequestModel,
  Report,
  ReportModel,
  Session,
  SessionModel,
  UnmatchedInbound,
  UnmatchedInboundModel,
  User,
  UserModel,
  Profile,
  ProfileModel,
  AttachmentFile,
  AttachmentFileModel,
  ContactCode,
  ContactCodeModel,
  BreachCheck,
  BreachCheckModel,
  Delisting,
  DelistingModel,
  NuisanceReport,
  NuisanceReportModel,
  RequestDoc,
} from './schemas';

const models = MongooseModule.forFeature([
  { name: User.name, schema: UserModel },
  { name: Session.name, schema: SessionModel },
  { name: Profile.name, schema: ProfileModel },
  { name: Authorization.name, schema: AuthorizationModel },
  { name: Broker.name, schema: BrokerModel },
  { name: RemovalRequest.name, schema: RemovalRequestModel },
  { name: Message.name, schema: MessageModel },
  { name: UnmatchedInbound.name, schema: UnmatchedInboundModel },
  { name: Notification.name, schema: NotificationModel },
  { name: Report.name, schema: ReportModel },
  { name: Lock.name, schema: LockModel },
  { name: ProcessedWebhook.name, schema: ProcessedWebhookModel },
  { name: AttachmentFile.name, schema: AttachmentFileModel },
  { name: ContactCode.name, schema: ContactCodeModel },
  { name: BreachCheck.name, schema: BreachCheckModel },
  { name: Delisting.name, schema: DelistingModel },
  { name: NuisanceReport.name, schema: NuisanceReportModel },
]);

/** Registers every Mongoose model once and exposes the shared infrastructure services. */
@Global()
@Module({
  imports: [models],
  providers: [CryptoService, Clock],
  exports: [models, CryptoService, Clock],
})
export class DbModule implements OnApplicationBootstrap {
  constructor(@InjectModel(RemovalRequest.name) private readonly requests: Model<RequestDoc>) {}

  /**
   * One-off index migration: the uniqueness of a request used to be (profile, broker, cycle); it now includes
   * the kind so an erasure and an access request can coexist. Databases created earlier still hold the old index.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.requests.collection.dropIndex('profileId_1_brokerKey_1_cycle_1');
    } catch {
      // not present (new database) or already dropped
    }
    await this.requests.createIndexes().catch((err: Error) => new Logger(DbModule.name).warn(`index creation: ${err.message}`));
  }
}
