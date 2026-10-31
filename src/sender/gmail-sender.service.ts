import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import { Clock } from '../common/clock';
import { CryptoService } from '../common/crypto.service';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { MailError, MailMessage, SendResult } from '../mail/mail.types';
import { SenderAuthError } from './smtp-sender.service';

export interface GmailSettings {
  /** The Google account that granted access; it is also the From address. */
  email: string;
  refreshToken: string;
}

/** The OAuth dance failed (bad or expired state, denied permission, unverified address...). */
export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailAuthError';
  }
}

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const SCOPES = ['openid', 'email', GMAIL_SEND_SCOPE];
const STATE_TTL_MS = 10 * 60 * 1000;
const HTTP_TIMEOUT_MS = 20_000;

/** What travels (encrypted) in the OAuth `state`: who started the flow and the PKCE verifier. */
interface StatePayload {
  u: string;
  p: string;
  v: string;
  exp: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GoogleApiError {
  error?: { code?: number; message?: string; errors?: { reason?: string }[] };
}

/** Best effort: tells Google to drop a grant (disconnecting, deleting a profile or the account). Never throws. */
export async function revokeGoogleToken(revokeUrl: string, refreshToken: string): Promise<void> {
  try {
    await fetch(revokeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch {
    // The user can also remove the access from their Google account page.
  }
}

const RATE_LIMIT_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'quotaExceeded'];

/** "Collega con Google": OAuth 2.0 (authorization code + PKCE, scope gmail.send only) and sending through the Gmail API. */
@Injectable()
export class GmailSenderService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
  ) {}

  get configured(): boolean {
    return !!this.config.googleClientId && !!this.config.googleClientSecret;
  }

  /** The Google consent URL. The state is encrypted and bound to the user and profile; no server-side session is needed. */
  authUrl(userId: string, profileId: string, loginHint?: string): string {
    const verifier = randomBytes(32).toString('base64url');
    const payload: StatePayload = { u: userId, p: profileId, v: verifier, exp: this.clock.now().getTime() + STATE_TTL_MS };
    const params = new URLSearchParams({
      client_id: this.config.googleClientId,
      redirect_uri: this.config.googleRedirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent', // makes Google return a refresh token even if the user connected before
      state: this.crypto.encryptJson(payload),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    if (loginHint) params.set('login_hint', loginHint);
    return `${this.config.googleAuthUrl}?${params.toString()}`;
  }

  /** Trades the authorization code for a refresh token and reads the verified Google address. */
  async exchange(userId: string, code: string, state: string): Promise<{ profileId: string; settings: GmailSettings }> {
    let payload: StatePayload;
    try {
      payload = this.crypto.decryptJson<StatePayload>(state);
    } catch {
      throw new GmailAuthError('Invalid or tampered state');
    }
    if (payload.u !== userId) throw new GmailAuthError('This authorization was started by another user');
    if (payload.exp < this.clock.now().getTime()) throw new GmailAuthError('The authorization expired: start again');

    const { status, body } = await this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.googleRedirectUri,
      code_verifier: payload.v,
    });
    if (status !== 200 || !body.access_token) {
      throw new GmailAuthError(`Google rejected the authorization (${body.error ?? status})`);
    }
    if (!body.scope?.split(' ').includes(GMAIL_SEND_SCOPE)) {
      throw new GmailAuthError('The permission to send email was not granted');
    }
    if (!body.refresh_token) throw new GmailAuthError('Google did not return a refresh token');
    const email = this.emailFromIdToken(body.id_token);
    return { profileId: payload.p, settings: { email, refreshToken: body.refresh_token } };
  }

  /** Sends one message from the user's Gmail. Auth problems become SenderAuthError (requests wait until reconnected). */
  async send(settings: GmailSettings, message: MailMessage): Promise<SendResult> {
    const accessToken = await this.accessToken(settings);
    const raw = await this.mime(settings, message);
    let res: Response;
    try {
      res = await fetch(`${this.config.gmailSendUrl}?uploadType=media`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'message/rfc822' },
        body: new Uint8Array(raw),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      throw new MailError(`Gmail connection problem: ${(err as Error).message}`, true);
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { id?: string };
      return { id: body.id ?? `gmail_${randomUUID()}`, dryRun: false };
    }
    throw await this.classify(res);
  }

  /** Best effort: tells Google to drop the grant when the user disconnects. Never throws. */
  revoke(settings: GmailSettings): Promise<void> {
    return revokeGoogleToken(this.config.googleRevokeUrl, settings.refreshToken);
  }

  private async token(form: Record<string, string>): Promise<{ status: number; body: TokenResponse }> {
    let res: Response;
    try {
      res = await fetch(this.config.googleTokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...form, client_id: this.config.googleClientId, client_secret: this.config.googleClientSecret }).toString(),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      throw new MailError(`Google connection problem: ${(err as Error).message}`, true);
    }
    return { status: res.status, body: (await res.json().catch(() => ({}))) as TokenResponse };
  }

  private async accessToken(settings: GmailSettings): Promise<string> {
    const { status, body } = await this.token({ grant_type: 'refresh_token', refresh_token: settings.refreshToken });
    if (status === 200 && body.access_token) return body.access_token;
    if (status >= 500 || status === 429) throw new MailError(`Google token endpoint error (${status})`, true);
    // invalid_grant: the user revoked access, changed password with a security reset, or the grant expired.
    throw new SenderAuthError('Google access was revoked or expired: connect your Gmail again');
  }

  private emailFromIdToken(idToken: string | undefined): string {
    try {
      const claims = JSON.parse(Buffer.from((idToken ?? '').split('.')[1] ?? '', 'base64url').toString('utf8')) as {
        email?: string;
        email_verified?: boolean;
      };
      if (!claims.email || claims.email_verified !== true) throw new Error('unverified');
      return claims.email.trim().toLowerCase();
    } catch {
      throw new GmailAuthError('Could not read a verified email address from Google');
    }
  }

  private mime(settings: GmailSettings, message: MailMessage): Promise<Buffer> {
    const composer = new MailComposer({
      from: message.from,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      headers: message.headers,
      messageId: `<${randomUUID()}@${settings.email.split('@')[1] ?? 'gmail.com'}>`,
      attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
    return new Promise((resolve, reject) => {
      composer.compile().build((err, buf) => (err ? reject(err) : resolve(buf)));
    });
  }

  private async classify(res: Response): Promise<MailError> {
    const body = (await res.json().catch(() => ({}))) as GoogleApiError;
    const reason = body.error?.errors?.[0]?.reason ?? '';
    const detail = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) return new SenderAuthError('Google access was revoked or expired: connect your Gmail again');
    if (res.status === 429 || (res.status === 403 && RATE_LIMIT_REASONS.includes(reason))) {
      return new MailError(`Gmail sending limit reached: ${detail}`, true);
    }
    if (res.status === 403) return new SenderAuthError('Google no longer allows Cancellamy to send from your Gmail: connect it again');
    if (res.status >= 500) return new MailError(`Gmail error (${res.status}): ${detail}`, true);
    return new MailError(`Gmail rejected the message (${res.status}): ${detail}`, false);
  }
}
