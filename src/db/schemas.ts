import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

// ---------------------------------------------------------------- users & sessions
@Schema({ _id: false })
export class UserSettingsSchema {
  @Prop({ default: true }) notifyByEmail!: boolean;
  @Prop({ default: true }) monthlyReport!: boolean;
}

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true }) email!: string;
  @Prop({ required: true }) passwordHash!: string;
  @Prop({ required: true, enum: ['user', 'admin'], default: 'user' }) role!: 'user' | 'admin';
  @Prop() emailVerifiedAt?: Date;
  @Prop({ index: true }) verifyTokenHash?: string;
  @Prop() verifyTokenExpires?: Date;
  @Prop({ index: true }) resetTokenHash?: string;
  @Prop() resetTokenExpires?: Date;
  @Prop({ type: UserSettingsSchema, default: () => ({ notifyByEmail: true, monthlyReport: true }) })
  settings!: UserSettingsSchema;
  @Prop({ required: true, default: 5 }) maxProfiles!: number;
  @Prop({ default: 0 }) failedLogins!: number;
  @Prop() lockedUntil?: Date;
  @Prop() termsAcceptedAt?: Date;
  createdAt!: Date;
}
export type UserDoc = HydratedDocument<User>;
export const UserModel = SchemaFactory.createForClass(User);

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'sessions' })
export class Session {
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ required: true, unique: true }) tokenHash!: string;
  @Prop({ required: true, index: true }) familyId!: string;
  @Prop({ required: true }) expiresAt!: Date;
  /** Set on any revocation (logout, reset, rotation, theft). */
  @Prop() revokedAt?: Date;
  /** Set only when the token was legitimately rotated: enables the short two-tab grace window. */
  @Prop() rotatedAt?: Date;
  @Prop() userAgent?: string;
}
export type SessionDoc = HydratedDocument<Session>;
export const SessionModel = SchemaFactory.createForClass(Session);
SessionModel.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ---------------------------------------------------------------- profiles & authorizations
@Schema({ _id: false })
export class VerifiedContact {
  @Prop({ required: true, enum: ['email', 'phone'] }) type!: 'email' | 'phone';
  /** Keyed hash of the normalised value: ownership is proven without storing the value twice. */
  @Prop({ required: true }) hash!: string;
  @Prop({ required: true }) at!: Date;
}
const VerifiedContactModel = SchemaFactory.createForClass(VerifiedContact);

@Schema({ timestamps: true, collection: 'profiles' })
export class Profile {
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ required: true, enum: ['draft', 'ready', 'active', 'paused'], default: 'draft' })
  status!: 'draft' | 'ready' | 'active' | 'paused';
  /** AES-GCM encrypted JSON of ProfileInput. */
  @Prop({ required: true }) pii!: string;
  @Prop({ required: true, unique: true }) replyToken!: string;
  @Prop() activatedAt?: Date;
  /** Who sends the emails: Cancellamy's own domain, the user's mailbox (SMTP) or the user's Gmail (OAuth). */
  @Prop({ required: true, enum: ['cancellamy', 'smtp', 'gmail'], default: 'cancellamy' }) senderMode!: 'cancellamy' | 'smtp' | 'gmail';
  /** AES-GCM encrypted JSON of the SMTP settings (including the password). */
  @Prop() smtpEnc?: string;
  /** AES-GCM encrypted JSON of the Gmail OAuth grant (address + refresh token). */
  @Prop() gmailEnc?: string;
  @Prop() smtpVerifiedAt?: Date;
  @Prop() senderError?: string;
  @Prop({ type: [VerifiedContactModel], default: [] }) verifiedContacts!: VerifiedContact[];
  @Prop() breachManualCheckAt?: Date;
  createdAt!: Date;
}
export type ProfileDoc = HydratedDocument<Profile>;
export const ProfileModel = SchemaFactory.createForClass(Profile);

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'authorizations' })
export class Authorization {
  @Prop({ type: Types.ObjectId, required: true, index: true }) profileId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ required: true }) signedAt!: Date;
  /** Encrypted typed signature (full name). */
  @Prop({ required: true }) signatureNameEnc!: string;
  @Prop({ required: true }) textVersion!: string;
  @Prop({ required: true }) textHash!: string;
  @Prop() ipHash?: string;
  @Prop() userAgent?: string;
  @Prop() revokedAt?: Date;
}
export type AuthorizationDoc = HydratedDocument<Authorization>;
export const AuthorizationModel = SchemaFactory.createForClass(Authorization);

// ---------------------------------------------------------------- brokers (registry)
@Schema({ _id: false })
export class BrokerChannel {
  @Prop({ required: true, enum: ['email', 'pec', 'web_form', 'phone', 'postal', 'other'] })
  type!: 'email' | 'pec' | 'web_form' | 'phone' | 'postal' | 'other';
  @Prop({ required: true }) value!: string;
  @Prop() label?: string;
  @Prop({ default: false }) verified!: boolean;
}
const BrokerChannelModel = SchemaFactory.createForClass(BrokerChannel);

@Schema({ timestamps: true, collection: 'brokers' })
export class Broker {
  @Prop({ required: true, unique: true }) slug!: string;
  @Prop({ required: true, index: true }) name!: string;
  @Prop() website?: string;
  @Prop() domain?: string;
  @Prop({ required: true, index: true }) category!: string;
  @Prop() hqCountry?: string;
  /** Countries (ISO 3166-1 alpha-2) the entry operates in, or ALL / EU / EEA. Empty = not classified yet. */
  @Prop({ type: [String], default: [] }) markets!: string[];
  /** At least one contact was read on the entity's own official site (registry provenance), not only validated automatically. */
  @Prop({ default: false }) officialSiteVerified!: boolean;
  @Prop({ required: true, index: true, default: 'needs_research' }) verificationStatus!: string;
  @Prop() lastVerified?: string;
  @Prop({ type: [BrokerChannelModel], default: [] }) channels!: BrokerChannel[];
  @Prop() legalBasisNote?: string;
  @Prop() obstacles?: string;
  @Prop() idRequested?: string;
  @Prop() notes?: string;
  @Prop({ default: false, index: true }) sendEnabled!: boolean;
  /** Fields edited by an admin: the registry reseed never overwrites them. */
  @Prop({ type: [String], default: [] }) adminEdited!: string[];
  @Prop({ type: [String], default: [] }) streams!: string[];
}
export type BrokerDoc = HydratedDocument<Broker>;
export const BrokerModel = SchemaFactory.createForClass(Broker);

// ---------------------------------------------------------------- removal requests
@Schema({ _id: false })
export class TimelineEntry {
  @Prop({ required: true }) at!: Date;
  @Prop({ required: true }) type!: string;
  @Prop() status?: string;
  @Prop() note?: string;
}
const TimelineEntryModel = SchemaFactory.createForClass(TimelineEntry);

@Schema({ _id: false })
export class ManualSpec {
  @Prop({ type: [String], default: [] }) steps!: string[];
  @Prop() url?: string;
  @Prop() phone?: string;
  @Prop() email?: string;
}
const ManualSpecModel = SchemaFactory.createForClass(ManualSpec);

@Schema({ _id: false })
export class CustomSpec {
  @Prop({ required: true }) name!: string;
  @Prop() website?: string;
  @Prop() contactEmail?: string;
  @Prop() notes?: string;
}
const CustomSpecModel = SchemaFactory.createForClass(CustomSpec);

@Schema({ timestamps: true, collection: 'removalrequests' })
export class RemovalRequest {
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true, index: true }) profileId!: Types.ObjectId;
  /** Broker slug, or `custom:<shortRef>` for custom removals. */
  @Prop({ required: true, index: true }) brokerKey!: string;
  @Prop({ required: true }) brokerName!: string;
  @Prop() brokerWebsite?: string;
  @Prop({ required: true }) brokerCategory!: string;
  @Prop({ required: true, unique: true }) shortRef!: string;
  /** erasure (art. 17/21) or access (art. 15). */
  @Prop({ required: true, enum: ['erasure', 'access'], default: 'erasure' }) kind!: 'erasure' | 'access';
  @Prop({ required: true, enum: ['email', 'manual'] }) channel!: 'email' | 'manual';
  @Prop({ required: true, index: true }) status!: string;
  @Prop() actionReason?: string;
  @Prop({ required: true, default: 1 }) cycle!: number;
  @Prop({ type: CustomSpecModel }) custom?: CustomSpec;
  @Prop({ type: ManualSpecModel }) manual?: ManualSpec;
  @Prop({ default: false }) dryRun!: boolean;
  @Prop() sentAt?: Date;
  @Prop() dueAt?: Date;
  @Prop() completedAt?: Date;
  @Prop() nextCheckAt?: Date;
  @Prop() renewedAt?: Date;
  @Prop({ required: true }) lastActivityAt!: Date;
  @Prop() lastOutgoingAt?: Date;
  @Prop({ default: 0 }) reminderCount!: number;
  @Prop({ default: 0 }) attempts!: number;
  @Prop() nextAttemptAt?: Date;
  @Prop() lockedUntil?: Date;
  @Prop() lastError?: string;
  /** Set when the delega was revoked: the request is revived if the profile is activated again. */
  @Prop() suspendedAt?: Date;
  /** First genuine answer from the broker (automatic acknowledgements do not count). */
  @Prop() firstReplyAt?: Date;
  /** Follow-up reminder already sent (RPO check after 15 days). */
  @Prop() followUpNotifiedAt?: Date;
  /** Access requests: what the user found after reading the answer. */
  @Prop({ type: Object }) findings?: { found: boolean; categories: string[]; noteEnc?: string; recordedAt: Date };
  @Prop({ type: [TimelineEntryModel], default: [] }) timeline!: TimelineEntry[];
  createdAt!: Date;
}
export type RequestDoc = HydratedDocument<RemovalRequest>;
export const RemovalRequestModel = SchemaFactory.createForClass(RemovalRequest);
RemovalRequestModel.index({ profileId: 1, brokerKey: 1, kind: 1, cycle: 1 }, { unique: true });
RemovalRequestModel.index({ status: 1, nextAttemptAt: 1 });
RemovalRequestModel.index({ userId: 1, status: 1, lastActivityAt: -1 });

@Schema()
export class MessageAttachment {
  _id!: Types.ObjectId;
  @Prop({ required: true }) filename!: string;
  @Prop({ required: true }) contentType!: string;
  @Prop() size?: number;
  /** Stored (encrypted) copy of an incoming file; absent for documents we never keep. */
  @Prop({ type: Types.ObjectId }) fileId?: Types.ObjectId;
  @Prop() expiresAt?: Date;
}
const MessageAttachmentModel = SchemaFactory.createForClass(MessageAttachment);

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'messages' })
export class Message {
  @Prop({ type: Types.ObjectId, required: true, index: true }) requestId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ required: true, enum: ['out', 'in'] }) direction!: 'out' | 'in';
  @Prop({ required: true }) at!: Date;
  @Prop({ required: true }) from!: string;
  @Prop({ type: [String], default: [] }) to!: string[];
  @Prop({ required: true }) subjectEnc!: string;
  @Prop({ required: true }) textEnc!: string;
  @Prop() providerId?: string;
  @Prop({ default: false }) dryRun!: boolean;
  @Prop() classification?: string;
  @Prop({ enum: ['resend', 'smtp', 'gmail', 'dry-run', 'inbound'] }) via?: 'resend' | 'smtp' | 'gmail' | 'dry-run' | 'inbound';
  @Prop({ type: [MessageAttachmentModel], default: [] }) attachments!: MessageAttachment[];
}
export type MessageDoc = HydratedDocument<Message>;
export const MessageModel = SchemaFactory.createForClass(Message);
MessageModel.index({ providerId: 1 }, { sparse: true });

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'unmatchedinbound' })
export class UnmatchedInbound {
  @Prop({ required: true }) receivedAt!: Date;
  @Prop({ required: true }) from!: string;
  @Prop({ type: [String], default: [] }) to!: string[];
  @Prop({ required: true }) subjectEnc!: string;
  @Prop({ required: true }) textEnc!: string;
  @Prop({ required: true, unique: true }) providerEmailId!: string;
  @Prop({ type: Types.ObjectId }) assignedRequestId?: Types.ObjectId;
}
export type UnmatchedInboundDoc = HydratedDocument<UnmatchedInbound>;
export const UnmatchedInboundModel = SchemaFactory.createForClass(UnmatchedInbound);

// ---------------------------------------------------------------- notifications, reports, infra
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'notifications' })
export class Notification {
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ required: true, enum: ['request_status', 'action_required', 'report', 'system'] })
  type!: 'request_status' | 'action_required' | 'report' | 'system';
  @Prop({ required: true }) title!: string;
  @Prop({ required: true }) body!: string;
  @Prop({ type: Types.ObjectId }) requestId?: Types.ObjectId;
  @Prop() readAt?: Date;
  createdAt!: Date;
}
export type NotificationDoc = HydratedDocument<Notification>;
export const NotificationModel = SchemaFactory.createForClass(Notification);
NotificationModel.index({ userId: 1, createdAt: -1 });

@Schema({ _id: false })
export class ReportStats {
  @Prop({ default: 0 }) sent!: number;
  @Prop({ default: 0 }) completed!: number;
  @Prop({ default: 0 }) refused!: number;
  @Prop({ default: 0 }) actionRequired!: number;
  @Prop({ default: 0 }) overdue!: number;
  @Prop({ default: 0 }) newlyCovered!: number;
}

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'reports' })
export class Report {
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) profileId!: Types.ObjectId;
  @Prop({ required: true }) period!: string;
  @Prop({ type: ReportStats, required: true }) stats!: ReportStats;
  @Prop({ type: [String], default: [] }) highlights!: string[];
  createdAt!: Date;
}
export type ReportDoc = HydratedDocument<Report>;
export const ReportModel = SchemaFactory.createForClass(Report);
ReportModel.index({ profileId: 1, period: 1 }, { unique: true });

@Schema({ collection: 'locks' })
export class Lock {
  @Prop({ required: true }) _id!: string;
  @Prop({ required: true }) until!: Date;
  @Prop({ required: true }) owner!: string;
}
export type LockDoc = HydratedDocument<Lock>;
export const LockModel = SchemaFactory.createForClass(Lock);

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'processedwebhooks' })
export class ProcessedWebhook {
  @Prop({ required: true, unique: true }) webhookId!: string;
}
export type ProcessedWebhookDoc = HydratedDocument<ProcessedWebhook>;
export const ProcessedWebhookModel = SchemaFactory.createForClass(ProcessedWebhook);
ProcessedWebhookModel.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

@Schema({ timestamps: true, collection: 'mailquotas' })
export class MailQuota {
  @Prop({ required: true, unique: true }) key!: string;
  @Prop({ required: true, default: 0 }) count!: number;
  @Prop({ required: true }) expiresAt!: Date;
}
export type MailQuotaDoc = HydratedDocument<MailQuota>;
export const MailQuotaModel = SchemaFactory.createForClass(MailQuota);
MailQuotaModel.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });


// ---------------------------------------------------------------- v2 collections
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'attachmentfiles' })
export class AttachmentFile {
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true, index: true }) requestId!: Types.ObjectId;
  @Prop({ required: true }) filename!: string;
  @Prop({ required: true }) contentType!: string;
  @Prop({ required: true }) size!: number;
  /** iv | tag | ciphertext */
  @Prop({ type: Buffer, required: true }) dataEnc!: Buffer;
  @Prop({ required: true }) expiresAt!: Date;
}
export type AttachmentFileDoc = HydratedDocument<AttachmentFile>;
export const AttachmentFileModel = SchemaFactory.createForClass(AttachmentFile);
AttachmentFileModel.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'contactcodes' })
export class ContactCode {
  @Prop({ type: Types.ObjectId, required: true }) profileId!: Types.ObjectId;
  @Prop({ required: true, enum: ['email', 'phone'] }) type!: 'email' | 'phone';
  @Prop({ required: true }) hash!: string;
  @Prop({ required: true }) codeHash!: string;
  @Prop({ default: 0 }) attempts!: number;
  @Prop({ default: 1 }) sends!: number;
  @Prop({ required: true }) windowStart!: Date;
  @Prop({ required: true }) lastSentAt!: Date;
  @Prop({ required: true }) expiresAt!: Date;
}
export type ContactCodeDoc = HydratedDocument<ContactCode>;
export const ContactCodeModel = SchemaFactory.createForClass(ContactCode);
ContactCodeModel.index({ profileId: 1, type: 1, hash: 1 }, { unique: true });
ContactCodeModel.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

@Schema({ _id: false })
export class BreachRecord {
  @Prop({ required: true }) name!: string;
  @Prop() title?: string;
  @Prop() breachDate?: string;
  @Prop() addedDate?: string;
  @Prop({ type: [String], default: [] }) dataClasses!: string[];
  @Prop() domain?: string;
  @Prop({ default: false }) isVerified!: boolean;
  @Prop({ default: false }) isSensitive!: boolean;
}
const BreachRecordModel = SchemaFactory.createForClass(BreachRecord);

@Schema({ timestamps: true, collection: 'breachchecks' })
export class BreachCheck {
  @Prop({ type: Types.ObjectId, required: true, index: true }) profileId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) userId!: Types.ObjectId;
  @Prop({ required: true }) emailHash!: string;
  @Prop({ required: true }) emailEnc!: string;
  @Prop({ required: true, enum: ['pending', 'checked', 'error'], default: 'pending' }) status!: 'pending' | 'checked' | 'error';
  @Prop() lastCheckedAt?: Date;
  @Prop({ required: true, index: true }) nextCheckAt!: Date;
  @Prop() lockedUntil?: Date;
  @Prop({ type: [BreachRecordModel], default: [] }) breaches!: BreachRecord[];
  @Prop({ default: false }) notifiedOnce!: boolean;
  @Prop() lastError?: string;
}
export type BreachCheckDoc = HydratedDocument<BreachCheck>;
export const BreachCheckModel = SchemaFactory.createForClass(BreachCheck);
BreachCheckModel.index({ profileId: 1, emailHash: 1 }, { unique: true });

@Schema({ timestamps: true, collection: 'delistings' })
export class Delisting {
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true, index: true }) profileId!: Types.ObjectId;
  @Prop({ required: true, enum: ['google', 'bing', 'other'] }) engine!: 'google' | 'bing' | 'other';
  @Prop({ required: true }) url!: string;
  @Prop() searchQuery?: string;
  @Prop({ required: true }) reason!: string;
  @Prop() explanation?: string;
  @Prop({ required: true, index: true, default: 'to_submit' }) status!: string;
  @Prop() submittedAt?: Date;
  @Prop() resolvedAt?: Date;
  @Prop() followUpAt?: Date;
  @Prop() followUpNotifiedAt?: Date;
  @Prop() note?: string;
  createdAt!: Date;
}
export type DelistingDoc = HydratedDocument<Delisting>;
export const DelistingModel = SchemaFactory.createForClass(Delisting);

@Schema({ timestamps: true, collection: 'nuisancereports' })
export class NuisanceReport {
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true, index: true }) profileId!: Types.ObjectId;
  @Prop({ required: true, enum: ['call', 'sms', 'messaging', 'email', 'post'] }) channel!: string;
  @Prop({ required: true }) receivedAt!: Date;
  @Prop({ required: true, enum: ['no', 'unknown'], default: 'unknown' }) consentGiven!: 'no' | 'unknown';
  /** AES-GCM encrypted JSON: { callerNumber?, company?, summary? } (information about third parties). */
  @Prop({ required: true }) dataEnc!: string;
  createdAt!: Date;
}
export type NuisanceReportDoc = HydratedDocument<NuisanceReport>;
export const NuisanceReportModel = SchemaFactory.createForClass(NuisanceReport);
