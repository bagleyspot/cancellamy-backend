import { createHash } from 'crypto';
import { Clock } from '../common/clock';
import { CryptoService } from '../common/crypto.service';
import { loadConfig } from '../config/app-config';
import { MailError } from '../mail/mail.types';
import { GMAIL_SEND_SCOPE, GmailAuthError, GmailSenderService, revokeGoogleToken } from './gmail-sender.service';
import { SenderAuthError } from './smtp-sender.service';

const env = {
  NODE_ENV: 'test',
  GOOGLE_OAUTH_CLIENT_ID: 'client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
  APP_URL: 'https://app.example.org',
};

function setup(overrides: Record<string, string> = {}) {
  const config = loadConfig({ ...env, ...overrides });
  const clock = new Clock();
  const crypto = new CryptoService(config);
  return { config, clock, crypto, service: new GmailSenderService(config, crypto, clock) };
}

const message = { from: '"Mario Rossi" <mario@example.it>', to: ['privacy@broker.example'], subject: 'Richiesta', text: 'ciao', replyTo: 'r-abc@in.example.org' };
const settings = { email: 'mario@example.it', refreshToken: 'rt-1' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('GmailSenderService', () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  beforeEach(() => fetchMock.mockReset());
  afterAll(() => fetchMock.mockRestore());

  describe('configuration', () => {
    it('is off unless both the client id and the secret are set', () => {
      expect(setup().service.configured).toBe(true);
      expect(setup({ GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '' }).service.configured).toBe(false);
      expect(() => loadConfig({ NODE_ENV: 'test', GOOGLE_OAUTH_CLIENT_ID: 'only-id' })).toThrow(/must be set together/);
    });

    it('redirects back to the app by default', () => {
      expect(setup().config.googleRedirectUri).toBe('https://app.example.org/app/collega-google');
    });
  });

  describe('authUrl', () => {
    it('asks only for the send permission with PKCE and an offline refresh token', () => {
      const url = new URL(setup().service.authUrl('user-1', 'profile-1', 'mario@example.it'));
      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe('client-id');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe(`openid email ${GMAIL_SEND_SCOPE}`);
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('login_hint')).toBe('mario@example.it');
      expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.org/app/collega-google');
    });

    it('keeps the PKCE verifier out of the URL: the state is opaque ciphertext', () => {
      const { service, crypto } = setup();
      const url = new URL(service.authUrl('user-1', 'profile-1'));
      const state = url.searchParams.get('state') as string;
      const payload = crypto.decryptJson<{ u: string; p: string; v: string }>(state);
      expect(payload).toMatchObject({ u: 'user-1', p: 'profile-1' });
      expect(state).not.toContain(payload.v);
      expect(url.toString()).not.toContain(payload.v);
      expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(payload.v).digest('base64url'));
    });
  });

  describe('exchange', () => {
    const stateFor = (service: GmailSenderService, userId = 'user-1') => new URL(service.authUrl(userId, 'profile-1')).searchParams.get('state') as string;

    it('rejects a tampered state, another user and an expired authorization before calling Google', async () => {
      const { service, clock } = setup();
      const state = stateFor(service);
      await expect(service.exchange('user-1', 'code', 'garbage')).rejects.toBeInstanceOf(GmailAuthError);
      await expect(service.exchange('user-1', 'code', state.slice(0, -4) + 'AAAA')).rejects.toBeInstanceOf(GmailAuthError);
      await expect(service.exchange('user-2', 'code', state)).rejects.toThrow(/another user/);
      clock.advance(11 * 60 * 1000);
      await expect(service.exchange('user-1', 'code', state)).rejects.toThrow(/expired/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requires the send permission, a refresh token and a verified address', async () => {
      const { service } = setup();
      const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
      const ok = { access_token: 'at', refresh_token: 'rt', scope: `openid email ${GMAIL_SEND_SCOPE}`, id_token: idToken({ email: 'Mario@Example.it', email_verified: true }) };

      fetchMock.mockResolvedValueOnce(json(200, { ...ok, scope: 'openid email' }));
      await expect(service.exchange('user-1', 'c', stateFor(service))).rejects.toThrow(/permission to send/);
      fetchMock.mockResolvedValueOnce(json(200, { ...ok, refresh_token: undefined }));
      await expect(service.exchange('user-1', 'c', stateFor(service))).rejects.toThrow(/refresh token/);
      fetchMock.mockResolvedValueOnce(json(200, { ...ok, id_token: idToken({ email: 'mario@example.it', email_verified: false }) }));
      await expect(service.exchange('user-1', 'c', stateFor(service))).rejects.toThrow(/verified email/);
      fetchMock.mockResolvedValueOnce(json(400, { error: 'invalid_grant' }));
      await expect(service.exchange('user-1', 'c', stateFor(service))).rejects.toThrow(/invalid_grant/);

      fetchMock.mockResolvedValueOnce(json(200, ok));
      const done = await service.exchange('user-1', 'c', stateFor(service));
      expect(done).toEqual({ profileId: 'profile-1', settings: { email: 'mario@example.it', refreshToken: 'rt' } });
    });
  });

  describe('send', () => {
    const tokenOk = () => json(200, { access_token: 'at-1' });

    it('uploads a MIME message with the headers and the attachment', async () => {
      const { service } = setup();
      fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(json(200, { id: 'gm-1' }));
      const res = await service.send(settings, { ...message, headers: { 'X-Cancellamy-Ref': 'CNC-ABC' }, attachments: [{ filename: 'delega.pdf', content: Buffer.from('%PDF'), contentType: 'application/pdf' }] });

      expect(res).toEqual({ id: 'gm-1', dryRun: false });
      const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toBe('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer at-1');
      expect((init.headers as Record<string, string>)['content-type']).toBe('message/rfc822');
      const raw = Buffer.from(init.body as Uint8Array).toString('utf8');
      expect(raw).toMatch(/^From: "?Mario Rossi"? <mario@example\.it>/m);
      expect(raw).toMatch(/^To: privacy@broker\.example/m);
      expect(raw).toMatch(/^Reply-To: r-abc@in\.example\.org/m);
      expect(raw).toMatch(/^X-Cancellamy-Ref: CNC-ABC/m);
      expect(raw).toContain('delega.pdf');
    });

    it('turns revoked grants into a SenderAuthError so the requests wait', async () => {
      const { service } = setup();
      fetchMock.mockResolvedValueOnce(json(400, { error: 'invalid_grant' }));
      await expect(service.send(settings, message)).rejects.toBeInstanceOf(SenderAuthError);
      fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(json(401, { error: { code: 401, message: 'Invalid Credentials' } }));
      await expect(service.send(settings, message)).rejects.toBeInstanceOf(SenderAuthError);
      fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(json(403, { error: { code: 403, message: 'Insufficient Permission', errors: [{ reason: 'insufficientPermissions' }] } }));
      await expect(service.send(settings, message)).rejects.toBeInstanceOf(SenderAuthError);
    });

    it('marks rate limits, server errors and network problems as transient, other rejections as permanent', async () => {
      const { service } = setup();
      const failure = async (second: Response | Error): Promise<MailError> => {
        fetchMock.mockResolvedValueOnce(tokenOk());
        if (second instanceof Error) fetchMock.mockRejectedValueOnce(second);
        else fetchMock.mockResolvedValueOnce(second);
        try {
          await service.send(settings, message);
        } catch (err) {
          return err as MailError;
        }
        throw new Error('expected the send to fail');
      };
      const rate = await failure(json(403, { error: { code: 403, message: 'Rate Limit Exceeded', errors: [{ reason: 'userRateLimitExceeded' }] } }));
      expect(rate).toBeInstanceOf(MailError);
      expect(rate).not.toBeInstanceOf(SenderAuthError);
      expect(rate.transient).toBe(true);
      expect((await failure(json(429, {}))).transient).toBe(true);
      expect((await failure(json(503, {}))).transient).toBe(true);
      expect((await failure(new TypeError('fetch failed'))).transient).toBe(true);
      const bad = await failure(json(400, { error: { code: 400, message: 'Invalid To header' } }));
      expect(bad.transient).toBe(false);
      expect(bad.message).toMatch(/Invalid To header/);
    });
  });

  describe('revoke', () => {
    it('posts the refresh token to Google and never throws', async () => {
      const { service } = setup();
      fetchMock.mockResolvedValueOnce(json(200, {}));
      await service.revoke(settings);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://oauth2.googleapis.com/revoke');
      expect(init.body).toBe('token=rt-1');

      fetchMock.mockRejectedValueOnce(new TypeError('offline'));
      await expect(revokeGoogleToken('https://oauth2.googleapis.com/revoke', 'rt-1')).resolves.toBeUndefined();
    });
  });
});
