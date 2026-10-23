/**
 * Cancellamy API contract - TypeScript types shared by backend and frontend.
 * Source of truth for every request/response body. All dates are ISO-8601 strings (UTC).
 * Base path of all endpoints: /api/v1 (except /health*). JSON in, JSON out unless noted.
 */

// ------------------------------------------------------------------ common
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number; // 1-based
  limit: number;
}

export interface ApiError {
  statusCode: number;
  error: string; // e.g. "Bad Request"
  message: string | string[];
  code?: ApiErrorCode;
}

export type ApiErrorCode =
  | 'EMAIL_NOT_VERIFIED'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_TOKEN'
  | 'PROFILE_LIMIT_REACHED'
  | 'AUTHORIZATION_REQUIRED'
  | 'PROFILE_NOT_READY'
  | 'INVALID_STATE'
  | 'RATE_LIMITED'
  | 'CUSTOM_LIMIT_REACHED'
  | 'SIMULATION_DISABLED'
  | 'VALIDATION_ERROR'
  | 'SMTP_CONNECTION_FAILED'
  | 'SMTP_HOST_NOT_ALLOWED'
  | 'IDENTITY_REQUIRED'
  | 'VERIFICATION_CODE_INVALID'
  | 'VERIFICATION_RATE_LIMITED'
  | 'FEATURE_DISABLED'
  | 'TIMESTAMP_UNAVAILABLE';

export type MailMode = 'dry-run' | 'resend';

/** Optional capabilities: the UI hides everything whose flag is false (self-hosters enable what they need). */
export interface FeatureFlags {
  senderSmtp: boolean; // send from the user's own mailbox
  dossier: boolean; // evidence dossier ZIP
  dossierTimestamp: boolean; // RFC 3161 timestamp authority configured
  accessRequests: boolean; // "Cosa sai di me" (art. 15)
  identityPhone: boolean; // SMS provider configured: phones can be verified
  breachCheck: boolean; // Have I Been Pwned API key configured
  delisting: boolean; // search-engine delisting tracker
  leaderboard: boolean; // public broker leaderboard
  nuisance: boolean; // telemarketing defence
}

export interface PublicConfigDto {
  features: FeatureFlags;
  leaderboardMinUsers: number;
  attachmentRetentionDays: number;
  mailMode: MailMode; // dry-run => UI must show a banner "Modalità prova: nessuna email reale viene inviata"
  maxProfiles: number;
  customRequestsPerMonth: number;
  appVersion: string;
  supportEmail: string;
  registryEntries: number;
  sendableBrokers: number;
}

// ------------------------------------------------------------------ auth / user
export type Role = 'user' | 'admin';

export interface UserSettings {
  notifyByEmail: boolean;
  monthlyReport: boolean;
}

export interface UserDto {
  id: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  maxProfiles: number;
  settings: UserSettings;
  createdAt: string;
}

export interface RegisterRequest {
  email: string;
  password: string; // min 10 chars
  acceptTerms: true;
}
export interface LoginRequest {
  email: string;
  password: string;
}
/** Refresh token travels ONLY in the httpOnly cookie `cnc_rt` (path /api/v1/auth). */
export interface AuthResponse {
  user: UserDto;
  accessToken: string; // JWT, 15 min, send as `Authorization: Bearer`
}
export interface TokenRequest {
  token: string;
}
export interface ForgotPasswordRequest {
  email: string;
}
export interface ResetPasswordRequest {
  token: string;
  password: string;
}
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
export interface UpdateMeRequest {
  settings: Partial<UserSettings>;
}
export interface DeleteAccountRequest {
  password: string;
}

// ------------------------------------------------------------------ profiles
export interface AddressDto {
  street: string;
  city: string;
  zip: string;
  province?: string;
  country: string; // ISO 3166-1 alpha-2, default "IT"
}

export interface ProfileInput {
  firstName: string;
  lastName: string;
  dateOfBirth?: string; // YYYY-MM-DD
  emails: string[]; // 1..5
  phones: string[]; // 0..5
  addresses: AddressDto[]; // 0..3
  fiscalCode?: string; // optional, only used for matching if the user wants
  aliases: string[]; // other name spellings, 0..5
}

export type ProfileStatus = 'draft' | 'ready' | 'active' | 'paused';
// draft  = no valid authorization signed yet
// ready  = authorization signed, requests not started
// active = requests running
// paused = user paused (no new emails are sent)

export interface AuthorizationDto {
  id: string;
  signedAt: string;
  signatureName: string;
  textVersion: string;
  revokedAt: string | null;
}

export interface RequestCounts {
  total: number;
  inProgress: number;
  actionRequired: number;
  completed: number;
  notRemovable: number;
}

export interface ProfileDto extends ProfileInput {
  id: string;
  identityVerified: boolean;
  senderMode: SenderMode;
  status: ProfileStatus;
  authorization: AuthorizationDto | null;
  requestCounts: RequestCounts;
  createdAt: string;
  activatedAt: string | null;
}

export interface AuthorizationTextDto {
  version: string;
  text: string; // Italian legal text of the delega, with the profile name already filled in
}
export interface SignAuthorizationRequest {
  signatureName: string; // must equal "<firstName> <lastName>" case-insensitively (trimmed)
  accepted: true;
}
export interface ActivateProfileResponse {
  emailRequests: number; // queued to be sent by email
  manualActions: number; // require user action (web form, phone...)
}

// ------------------------------------------------------------------ brokers (registry)
export type BrokerCategory =
  | 'regulator'
  | 'opposition_register'
  | 'phone_directory'
  | 'caller_id_app'
  | 'reverse_lookup'
  | 'business_register'
  | 'business_info'
  | 'credit_bureau'
  | 'kyc_pep'
  | 'lead_seller'
  | 'people_search'
  | 'b2b_enrichment'
  | 'marketing_adtech'
  | 'recruitment'
  | 'risk_mitigation'
  | 'data_broker'
  | 'address_data'
  | 'search_engine'
  | 'news_archive'
  | 'public_records'
  | 'other';

export type VerificationStatus =
  | 'verified'
  | 'verified_needs_review'
  | 'third_party'
  | 'needs_research';

export type ChannelType = 'email' | 'pec' | 'web_form' | 'phone' | 'postal' | 'other';

export interface BrokerChannelDto {
  type: ChannelType;
  value: string;
  label?: string;
  verified: boolean;
}

export interface BrokerSummary {
  id: string;
  name: string;
  website: string | null;
  category: BrokerCategory;
}

export interface BrokerDto extends BrokerSummary {
  hqCountry: string | null;
  verificationStatus: VerificationStatus;
  lastVerified: string | null;
  channelTypes: ChannelType[];
  channels: BrokerChannelDto[]; // public registry data
  legalBasisNote: string | null;
  obstacles: string | null;
  idRequested: string | null; // yes | no | maybe | not-stated
  incogniListed: boolean;
  sendEnabled: boolean; // false => not contacted automatically yet
  notes: string | null;
}

export interface BrokerStatsDto {
  total: number;
  sendable: number;
  italySpecific: number;
  byCategory: { category: BrokerCategory; count: number }[];
  byStatus: { status: VerificationStatus; count: number }[];
}

// ------------------------------------------------------------------ requests
export type RequestStatus =
  | 'queued'
  | 'sent'
  | 'replied'
  | 'action_required'
  | 'overdue'
  | 'escalated'
  | 'completed'
  | 'refused'
  | 'cancelled';

/** UI grouping (same as the four tabs of the dashboard). */
export type RequestGroup = 'in_progress' | 'action_required' | 'completed' | 'not_removable';
// in_progress: queued, sent, replied, overdue, escalated
// action_required: action_required
// completed: completed
// not_removable: refused, cancelled

export type RequestChannel = 'email' | 'manual';
export type RequestKind = 'erasure' | 'access'; // erasure + objection (art. 17, 21) or right of access (art. 15)
export type ActionReason = 'id_required' | 'manual_form' | 'manual_steps' | 'more_info' | 'reply_review';
export type ReplyLabel = 'completed' | 'refused' | 'id_required' | 'more_info' | 'auto_reply' | 'data_provided' | 'unknown';

export interface RequestListItem {
  kind: RequestKind;
  id: string;
  shortRef: string; // "CNC-7K2P9Q4M" (CNC- + 8 chars), appears in the email subject
  profileId: string;
  broker: BrokerSummary;
  channel: RequestChannel;
  status: RequestStatus;
  group: RequestGroup;
  actionReason: ActionReason | null;
  cycle: number; // 1 = first request, >1 = periodic renewal
  custom: boolean;
  dryRun: boolean; // true when the email was only recorded, never really sent
  createdAt: string;
  sentAt: string | null;
  dueAt: string | null; // sentAt + 30 days (art. 12.3 GDPR)
  completedAt: string | null;
  nextCheckAt: string | null; // when the renewal will be sent
  lastActivityAt: string;
}

export type TimelineEventType =
  | 'created'
  | 'sent'
  | 'reminder_sent'
  | 'reply_received'
  | 'status_changed'
  | 'id_provided'
  | 'escalated'
  | 'renewed'
  | 'marked_done'
  | 'note';

export interface TimelineEvent {
  at: string;
  type: TimelineEventType;
  status?: RequestStatus;
  note?: string;
}

export interface MessageAttachmentDto {
  id: string; // use with GET /requests/:id/messages/:messageId/attachments/:attachmentId
  filename: string;
  contentType: string;
  size?: number;
  downloadable: boolean; // false for outgoing ones, documents we never store, and expired incoming files
  expiresAt: string | null; // incoming files are deleted after `attachmentRetentionDays`
}

export interface MessageDto {
  id: string;
  direction: 'out' | 'in';
  at: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  classification: ReplyLabel | null;
  dryRun: boolean;
  via: 'resend' | 'smtp' | 'dry-run' | 'inbound';
  attachments: MessageAttachmentDto[];
}

export interface ManualInstructions {
  steps: string[];
  url?: string;
  phone?: string;
  email?: string;
  prefillText: string; // ready-to-copy request text with the user's data
}

export interface AccessFindingsDto {
  found: boolean;
  categories: DataCategory[];
  note: string | null;
  recordedAt: string;
}

export interface RequestDetail extends RequestListItem {
  broker: BrokerDto;
  /** Only for kind 'access': what the user recorded after reading the broker's answer. */
  findings: AccessFindingsDto | null;
  /** Message `via`: how each outgoing email was delivered is in MessageDto.via. */
  timeline: TimelineEvent[];
  messages: MessageDto[];
  manual: ManualInstructions | null;
  canRemind: boolean;
  canEscalate: boolean;
  canProvideId: boolean;
  canSimulateReply: boolean; // true only in dry-run mode
}

export interface ListRequestsQuery {
  kind?: RequestKind;
  profileId?: string;
  group?: RequestGroup;
  status?: RequestStatus;
  category?: BrokerCategory;
  q?: string; // matches broker name
  page?: number;
  limit?: number; // default 20, max 100
}

export interface OutcomeRequest {
  outcome: 'completed' | 'refused' | 'action_required' | 'in_progress';
  note?: string;
}

export interface CustomRequestInput {
  profileId: string;
  name: string; // organisation / site name
  website?: string;
  contactEmail?: string; // if present the request is sent by email, otherwise it becomes a manual action
  notes?: string;
}

export interface SimulateReplyRequest {
  kind: 'completed' | 'refused' | 'id_required' | 'unknown';
}

export interface ComplaintDto {
  text: string; // draft "reclamo al Garante" in Italian
  generatedAt: string;
  pdfUrl: string; // GET /api/v1/requests/:id/complaint.pdf (needs Bearer)
  submitUrl: string; // where to file it
  steps: string[];
}

export interface SummaryDto {
  counts: RequestCounts;
  coverage: {
    brokersTracked: number; // entries in the registry
    brokersCovered: number; // requests created for this profile
    brokersNotYetCovered: number;
  };
  completionRate: number; // 0..1 completed / (total - notRemovable)
  byCategory: { category: BrokerCategory; total: number; completed: number }[];
  completedByMonth: { month: string; count: number }[]; // YYYY-MM, last 12
  recentActivity: { at: string; requestId: string; brokerName: string; text: string }[]; // max 10
}

// ------------------------------------------------------------------ notifications & reports
export interface NotificationDto {
  id: string;
  type: 'request_status' | 'action_required' | 'report' | 'system';
  title: string;
  body: string;
  requestId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ReportDto {
  id: string;
  profileId: string;
  period: string; // YYYY-MM
  createdAt: string;
  stats: {
    sent: number;
    completed: number;
    refused: number;
    actionRequired: number;
    overdue: number;
    newlyCovered: number;
  };
  highlights: string[];
}

// ------------------------------------------------------------------ admin
export interface AdminStatsDto {
  users: number;
  profiles: number;
  activeProfiles: number;
  requestsByStatus: { status: RequestStatus; count: number }[];
  messagesOut: number;
  messagesIn: number;
  unmatchedInbound: number;
  mailMode: MailMode;
}

export interface AdminBrokerPatch {
  sendEnabled?: boolean;
  verificationStatus?: VerificationStatus;
  channels?: BrokerChannelDto[];
  notes?: string | null;
}

export interface AutoVerifyResultDto {
  checked: number;
  promoted: number;
  discovered: number;
  sendable: number;
}

export interface UnmatchedInboundDto {
  id: string;
  receivedAt: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  assignedRequestId: string | null;
}

export interface OutboxItemDto {
  id: string;
  requestId: string;
  at: string;
  to: string[];
  subject: string;
  dryRun: boolean;
  providerId: string | null;
}


// ================================================================== v2 features

// ------------------------------------------------------------------ 1. send from the user's own mailbox (SMTP)
export type SenderMode = 'cancellamy' | 'smtp';

export interface SmtpSettingsDto {
  host: string;
  port: number; // 25, 465, 587 or 2525
  secure: boolean; // implicit TLS (465); STARTTLS is always required otherwise
  username: string;
  fromAddress: string; // must be one of the profile's emails
}

export interface SmtpSettingsInput extends SmtpSettingsDto {
  password: string; // never returned
}

export interface SenderDto {
  mode: SenderMode;
  smtp: SmtpSettingsDto | null;
  verifiedAt: string | null; // last successful connection test
  lastError: string | null; // set when sending failed; requests of the profile wait until fixed
  /** Replies from brokers are directed here (so Cancellamy can track them). Shown for transparency. */
  replyAddress: string;
}

export interface SetSenderRequest {
  mode: SenderMode;
  smtp?: SmtpSettingsInput; // required when mode = 'smtp'
}

// ------------------------------------------------------------------ 3a. identity (contact ownership)
export interface IdentityContactDto {
  type: 'email' | 'phone';
  value: string;
  verified: boolean;
  verifiedAt: string | null;
}

export interface IdentityDto {
  verified: boolean; // every email (and every phone if requiresPhone) is verified
  requiresPhone: boolean; // true when the instance has an SMS provider (features.identityPhone)
  contacts: IdentityContactDto[];
}

export interface SendCodeRequest {
  type: 'email' | 'phone';
  value: string; // must be one of the profile's contacts
}
export interface ConfirmCodeRequest extends SendCodeRequest {
  code: string; // 6 digits, valid 15 minutes, 5 attempts
}

// ------------------------------------------------------------------ 3b. right of access ("Cosa sai di me")
export type DataCategory =
  | 'identifiers'
  | 'contacts'
  | 'addresses'
  | 'professional'
  | 'financial'
  | 'online_activity'
  | 'location'
  | 'demographics'
  | 'other';

export interface CreateAccessRequestsInput {
  profileId: string;
  brokerIds: string[]; // 1..20 broker ids from the catalogue
}

export interface CreateAccessRequestsResponse {
  created: RequestListItem[];
  skipped: { brokerId: string; reason: 'exists' | 'not_contactable' | 'not_found' }[];
}

export interface AccessFindingsInput {
  found: boolean;
  categories: DataCategory[];
  note?: string;
}

export interface DataMapEntry {
  requestId: string;
  shortRef: string;
  broker: BrokerSummary;
  status: RequestStatus;
  found: boolean | null; // null = not answered/recorded yet
  categories: DataCategory[];
  updatedAt: string;
}

export interface DataMapDto {
  entries: DataMapEntry[];
  totals: { asked: number; answered: number; found: number; notFound: number };
  categoryCounts: { category: DataCategory; count: number }[];
}

// ------------------------------------------------------------------ 4. breach check (Have I Been Pwned)
export interface BreachDto {
  name: string;
  title: string;
  breachDate: string | null;
  addedDate: string | null;
  dataClasses: string[];
  domain: string | null;
  isVerified: boolean;
  isSensitive: boolean;
}

export interface BreachEmailDto {
  email: string;
  status: 'pending' | 'checked' | 'error';
  lastCheckedAt: string | null;
  breaches: BreachDto[];
}

export interface BreachSummaryDto {
  enabled: boolean;
  attribution: string; // must be shown: "Breach data provided by Have I Been Pwned" (link: https://haveibeenpwned.com)
  emails: BreachEmailDto[]; // only emails whose ownership was verified
  unverifiedEmails: string[]; // verify them in the identity card to enable the check
}

// ------------------------------------------------------------------ 5. search-engine delisting
export type SearchEngine = 'google' | 'bing' | 'other';
export type DelistingReason = 'outdated' | 'irrelevant' | 'inaccurate' | 'excessive' | 'no_public_interest' | 'other';
export type DelistingStatus =
  | 'to_submit'
  | 'submitted'
  | 'approved'
  | 'partially_approved'
  | 'denied'
  | 'appealed'
  | 'cancelled';

export interface DelistingInput {
  profileId: string;
  engine: SearchEngine;
  url: string; // http(s), the page to remove from results
  searchQuery?: string; // the query (usually the person's name) for which the result must disappear
  reason: DelistingReason;
  explanation?: string;
}

export interface DelistingDto {
  id: string;
  profileId: string;
  engine: SearchEngine;
  url: string;
  searchQuery: string | null;
  reason: DelistingReason;
  explanation: string | null;
  status: DelistingStatus;
  submittedAt: string | null;
  resolvedAt: string | null;
  followUpAt: string | null; // submittedAt + 30 days: a reminder notification is sent
  note: string | null;
  createdAt: string;
}

export interface DelistingPatch {
  status?: DelistingStatus;
  note?: string;
  explanation?: string;
}

export interface DelistingGuideDto {
  engineName: string;
  formUrl: string | null; // Google: https://reportcontent.google.com/forms/rtbf, Bing: https://www.bing.com/webmaster/tools/eu-privacy-request
  steps: string[];
  statement: string; // ready-to-paste motivation (Italian)
  tips: string[];
}

// ------------------------------------------------------------------ 6. public broker leaderboard
export interface BrokerPerformanceDto {
  broker: BrokerSummary;
  requests: number;
  users: number; // distinct users (always >= minUsers)
  responseRate: number; // 0..1
  completionRate: number;
  refusalRate: number;
  overdueRate: number;
  medianDaysToFirstReply: number | null;
  medianDaysToCompletion: number | null;
}

export interface LeaderboardDto {
  minUsers: number;
  generatedAt: string;
  items: BrokerPerformanceDto[];
  hiddenBrokers: number; // tracked brokers without enough data (privacy threshold)
}

export type LeaderboardSort = 'responseRate' | 'completionRate' | 'refusalRate' | 'medianDaysToFirstReply' | 'users';

// ------------------------------------------------------------------ 7. telemarketing defence
export type NuisanceChannel = 'call' | 'sms' | 'messaging' | 'email' | 'post';

export interface NuisanceReportInput {
  profileId: string;
  channel: NuisanceChannel;
  callerNumber?: string; // caller number or sender, free text (e.g. "+39 02 1234567", "anonimo")
  company?: string; // who they said they were calling for
  receivedAt: string; // ISO
  summary?: string; // what they offered / said
  consentGiven?: 'no' | 'unknown'; // did you ever agree to be contacted?
}

export interface NuisanceReportDto {
  id: string;
  profileId: string;
  channel: NuisanceChannel;
  callerNumber: string | null;
  company: string | null;
  receivedAt: string;
  summary: string | null;
  consentGiven: 'no' | 'unknown';
  /** true when the RPO registration (completed >= 15 days earlier) was in force at that time; null if not registered. */
  rpoActiveAtTime: boolean | null;
  createdAt: string;
}

export interface NuisanceOverviewDto {
  rpo: {
    registered: boolean; // the RPO manual request of the profile is completed
    requestId: string | null;
    completedAt: string | null;
    effectiveFrom: string | null; // completedAt + 15 days
  };
  reports: NuisanceReportDto[];
  topCallers: { callerNumber: string | null; company: string | null; count: number; lastAt: string }[];
}

export interface NuisanceComplaintRequest {
  profileId: string;
  reportIds?: string[]; // default: all
}
