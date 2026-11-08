import { Global, Module } from '@nestjs/common';
import { join } from 'path';
import { RELEVANCE_MODES, RelevanceMode } from '../brokers/relevance';

export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * - `dry-run`: nothing leaves the machine; emails are recorded (and replies can be simulated);
 * - `resend`: Cancellamy's provider sends (needs RESEND_API_KEY and the inbound domain);
 * - `mailbox`: broker emails leave only from the user's own mailbox (SMTP or Gmail); system emails are only logged. Meant for
 *   running locally without Resend: replies land in the user's inbox.
 */
export type MailMode = 'dry-run' | 'resend' | 'mailbox';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  mongoUri: string;
  jwtAccessSecret: string;
  dataEncryptionKey: Buffer;
  appUrl: string;
  corsOrigins: string[];
  cookieSecure: boolean;
  cookieSameSite: 'lax' | 'strict' | 'none';
  trustProxy: boolean;
  mailMode: MailMode;
  /** mailbox mode only: every broker email is sent to this address instead, to try the flow without writing to anyone. */
  mailRedirectTo: string;
  mailFrom: string;
  supportEmail: string;
  inboundDomain: string;
  resendApiKey: string;
  resendWebhookSecret: string;
  operatorName: string;
  operatorAddress: string;
  maxProfilesPerUser: number;
  customRequestsPerMonth: number;
  adminEmails: string[];
  throttleLimit: number;
  authThrottleLimit: number;
  schedulerEnabled: boolean;
  schedulerIntervalSeconds: number;
  cronSecret: string;
  responseDeadlineDays: number;
  reminderIntervalDays: number;
  renewalDays: number;
  sendBatchSize: number;
  resendDailyLimit: number;
  resendMonthlyLimit: number;
  resendSystemReserve: number;
  userDailyRequestLimit: number;
  redisUrl: string;
  redisHost: string;
  redisPort: number;
  redisUsername: string;
  redisPassword?: string;
  redisTls: boolean;
  queueEnabled: boolean;
  /** How brokers are chosen and ordered for a new profile (see brokers/relevance.ts). */
  brokerRelevance: RelevanceMode;
  seedOnBoot: boolean;
  registryPath: string;
  appVersion: string;
  // --- optional capabilities (self-hosters enable what they need)
  featuresDisabled: string[];
  haveIBeenPwnedApiKey: string;
  hibpUserAgent: string;
  hibpRequestIntervalMs: number;
  breachRecheckDays: number;
  smsProvider: 'none' | 'dry-run' | 'twilio';
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFrom: string;
  identityRequirePhone: boolean;
  tsaUrl: string;
  leaderboardMinUsers: number;
  attachmentRetentionDays: number;
  maxAttachmentBytes: number;
  /** Development/test only: allow SMTP hosts on private networks and any port. */
  smtpAllowPrivateHosts: boolean;
  // --- "Collega con Google": OAuth client of the operator (both empty = feature off)
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  /** Google endpoints; overridable only so tests can point them at a local fake. */
  googleAuthUrl: string;
  googleTokenUrl: string;
  googleRevokeUrl: string;
  gmailSendUrl: string;
}

export const FEATURE_NAMES = ['sender', 'dossier', 'access', 'delisting', 'leaderboard', 'nuisance', 'breach'] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

export interface FeatureFlags {
  senderSmtp: boolean;
  senderGmail: boolean;
  dossier: boolean;
  dossierTimestamp: boolean;
  accessRequests: boolean;
  identityPhone: boolean;
  breachCheck: boolean;
  delisting: boolean;
  leaderboard: boolean;
  nuisance: boolean;
}

export function computeFeatures(c: AppConfig): FeatureFlags {
  const on = (f: FeatureName) => !c.featuresDisabled.includes(f);
  return {
    senderSmtp: on('sender'),
    senderGmail: on('sender') && !!c.googleClientId && !!c.googleClientSecret,
    dossier: on('dossier'),
    dossierTimestamp: on('dossier') && !!c.tsaUrl,
    accessRequests: on('access'),
    identityPhone: c.smsProvider !== 'none',
    breachCheck: on('breach') && !!c.haveIBeenPwnedApiKey,
    delisting: on('delisting'),
    leaderboard: on('leaderboard'),
    nuisance: on('nuisance'),
  };
}

type Env = Record<string, string | undefined>;

function int(env: Env, key: string, def: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`Invalid ${key}: expected integer >= ${min}`);
  return n;
}

function bool(env: Env, key: string, def: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function list(env: Env, key: string): string[] {
  return (env[key] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parses and validates the environment. Throws with a clear message on misconfiguration. */
export function loadConfig(env: Env = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('Invalid NODE_ENV');
  const prod = nodeEnv === 'production';

  const mailMode = (env.MAIL_MODE ?? 'dry-run') as MailMode;
  if (!['dry-run', 'resend', 'mailbox'].includes(mailMode)) throw new Error('MAIL_MODE must be dry-run, resend or mailbox');
  const mailRedirectTo = (env.MAIL_REDIRECT_TO ?? '').trim().toLowerCase();
  if (mailRedirectTo && mailMode !== 'mailbox') throw new Error('MAIL_REDIRECT_TO is only used with MAIL_MODE=mailbox');
  if (mailRedirectTo && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(mailRedirectTo)) throw new Error('MAIL_REDIRECT_TO must be an email address');
  if (mailMode === 'resend' && !env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required when MAIL_MODE=resend');
  if (mailMode === 'resend' && !env.INBOUND_DOMAIN) throw new Error('INBOUND_DOMAIN is required when MAIL_MODE=resend');

  const jwtAccessSecret = env.JWT_ACCESS_SECRET ?? (prod ? '' : 'dev-only-insecure-jwt-secret-change-me-please');
  if (jwtAccessSecret.length < 32) throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');

  const keyB64 = env.DATA_ENCRYPTION_KEY ?? (prod ? '' : Buffer.alloc(32, 7).toString('base64'));
  const dataEncryptionKey = Buffer.from(keyB64, 'base64');
  if (dataEncryptionKey.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be base64 of exactly 32 bytes');

  const sameSite = (env.COOKIE_SAMESITE ?? 'lax').toLowerCase() as AppConfig['cookieSameSite'];
  if (!['lax', 'strict', 'none'].includes(sameSite)) throw new Error('COOKIE_SAMESITE must be lax, strict or none');
  const cookieSecure = bool(env, 'COOKIE_SECURE', prod);
  if (sameSite === 'none' && !cookieSecure) throw new Error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true');

  const smsProvider = (env.SMS_PROVIDER ?? 'none') as AppConfig['smsProvider'];
  if (!['none', 'dry-run', 'twilio'].includes(smsProvider)) throw new Error('SMS_PROVIDER must be none, dry-run or twilio');
  if (smsProvider === 'twilio' && !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM)) {
    throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are required when SMS_PROVIDER=twilio');
  }
  const featuresDisabled = list(env, 'FEATURES_DISABLED').map((f) => f.toLowerCase());
  for (const f of featuresDisabled) {
    if (!(FEATURE_NAMES as readonly string[]).includes(f)) throw new Error(`Unknown feature in FEATURES_DISABLED: ${f}`);
  }
  const tsaUrl = env.TSA_URL ?? '';
  if (tsaUrl && !/^https?:\/\//.test(tsaUrl)) throw new Error('TSA_URL must be an http(s) URL');

  const brokerRelevance = (env.BROKER_RELEVANCE ?? 'prioritize').toLowerCase() as RelevanceMode;
  if (!RELEVANCE_MODES.includes(brokerRelevance)) {
    throw new Error(`Invalid BROKER_RELEVANCE: expected one of ${RELEVANCE_MODES.join(', ')}`);
  }
  const googleClientId = env.GOOGLE_OAUTH_CLIENT_ID ?? '';
  const googleClientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
  if (!!googleClientId !== !!googleClientSecret) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set together');
  }
  const appUrl = (env.APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  const inboundDomain = env.INBOUND_DOMAIN ?? 'in.example.org';

  return {
    nodeEnv,
    port: int(env, 'PORT', 3000, 1),
    logLevel: env.LOG_LEVEL ?? 'info',
    mongoUri: env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/cancellamy',
    jwtAccessSecret,
    dataEncryptionKey,
    appUrl,
    corsOrigins: env.CORS_ORIGINS ? list(env, 'CORS_ORIGINS') : [appUrl],
    cookieSecure,
    cookieSameSite: sameSite,
    trustProxy: bool(env, 'TRUST_PROXY', false),
    mailMode,
    mailRedirectTo,
    mailFrom: env.MAIL_FROM ?? 'Cancellamy <richieste@example.org>',
    supportEmail: env.SUPPORT_EMAIL ?? 'supporto@example.org',
    inboundDomain,
    resendApiKey: env.RESEND_API_KEY ?? '',
    resendWebhookSecret: env.RESEND_WEBHOOK_SECRET ?? '',
    operatorName: env.OPERATOR_NAME ?? 'Cancellamy (istanza di prova)',
    operatorAddress: env.OPERATOR_ADDRESS ?? '',
    maxProfilesPerUser: int(env, 'MAX_PROFILES_PER_USER', 5, 1),
    customRequestsPerMonth: int(env, 'CUSTOM_REQUESTS_PER_MONTH', 10, 0),
    adminEmails: list(env, 'ADMIN_EMAILS').map((e) => e.toLowerCase()),
    throttleLimit: int(env, 'THROTTLE_LIMIT', 120, 1),
    authThrottleLimit: int(env, 'AUTH_THROTTLE_LIMIT', 10, 1),
    schedulerEnabled: bool(env, 'SCHEDULER_ENABLED', true),
    schedulerIntervalSeconds: int(env, 'SCHEDULER_INTERVAL_SECONDS', 60, 5),
    cronSecret: env.CRON_SECRET ?? '',
    responseDeadlineDays: int(env, 'RESPONSE_DEADLINE_DAYS', 30, 1),
    reminderIntervalDays: int(env, 'REMINDER_INTERVAL_DAYS', 15, 1),
    renewalDays: int(env, 'RENEWAL_DAYS', 90, 1),
    sendBatchSize: int(env, 'SEND_BATCH_SIZE', 25, 1),
    resendDailyLimit: int(env, 'RESEND_DAILY_LIMIT', 100, 1),
    resendMonthlyLimit: int(env, 'RESEND_MONTHLY_LIMIT', 3000, 1),
    resendSystemReserve: int(env, 'RESEND_SYSTEM_RESERVE', 5, 0),
    userDailyRequestLimit: int(env, 'USER_DAILY_REQUEST_LIMIT', 5, 1),
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    redisHost: env.REDIS_HOST ?? 'localhost',
    redisPort: int(env, 'REDIS_PORT', 6379, 1),
    redisUsername: env.REDIS_USERNAME ?? 'default',
    redisPassword: env.REDIS_PASSWORD ?? '',
    redisTls: bool(env, 'REDIS_TLS', false),
    queueEnabled: bool(env, 'QUEUE_ENABLED', nodeEnv !== 'test'),
    brokerRelevance,
    seedOnBoot: bool(env, 'SEED_ON_BOOT', true),
    registryPath: env.REGISTRY_PATH ?? join(process.cwd(), 'registry', 'brokers.yaml'),
    appVersion: env.npm_package_version ?? '0.1.0',
    featuresDisabled,
    haveIBeenPwnedApiKey: env.HAVEIBEENPWNED_API_KEY ?? '',
    hibpUserAgent: env.HIBP_USER_AGENT ?? 'Cancellamy',
    hibpRequestIntervalMs: int(env, 'HIBP_REQUEST_INTERVAL_MS', 6500, 0),
    breachRecheckDays: int(env, 'BREACH_RECHECK_DAYS', 30, 1),
    smsProvider,
    twilioAccountSid: env.TWILIO_ACCOUNT_SID ?? '',
    twilioAuthToken: env.TWILIO_AUTH_TOKEN ?? '',
    twilioFrom: env.TWILIO_FROM ?? '',
    identityRequirePhone: bool(env, 'IDENTITY_REQUIRE_PHONE', smsProvider !== 'none'),
    tsaUrl,
    leaderboardMinUsers: int(env, 'LEADERBOARD_MIN_USERS', 20, 1),
    attachmentRetentionDays: int(env, 'ATTACHMENT_RETENTION_DAYS', 30, 1),
    maxAttachmentBytes: int(env, 'MAX_ATTACHMENT_BYTES', 10 * 1024 * 1024, 1),
    smtpAllowPrivateHosts: bool(env, 'SMTP_ALLOW_PRIVATE_HOSTS', false),
    googleClientId,
    googleClientSecret,
    googleRedirectUri: env.GOOGLE_OAUTH_REDIRECT_URI ?? `${appUrl}/app/collega-google`,
    googleAuthUrl: env.GOOGLE_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth',
    googleTokenUrl: env.GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token',
    googleRevokeUrl: env.GOOGLE_REVOKE_URL ?? 'https://oauth2.googleapis.com/revoke',
    gmailSendUrl: env.GMAIL_SEND_URL ?? 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send',
  };
}

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
