import { createHash } from 'crypto';
import { createServer, IncomingMessage, Server } from 'http';
import { Types } from 'mongoose';
import { AddressInfo } from 'net';
import { TestCtx, authed, createTestApp, detail, mailsForRef, profileInput, register, requestByBroker, uniqueEmail } from './helpers';

interface Sent {
  authorization: string;
  contentType: string;
  raw: string;
}

/** A tiny fake of the three Google endpoints Cancellamy talks to (token, Gmail upload, revoke). */
const google = {
  challenge: '',
  revokedGrant: false,
  sendStatus: 200,
  sends: [] as Sent[],
  revoked: [] as string[],
  redirectUris: [] as string[],
  reset() {
    this.challenge = '';
    this.revokedGrant = false;
    this.sendStatus = 200;
    this.sends.length = 0;
    this.revoked.length = 0;
    this.redirectUris.length = 0;
  },
};

const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const idToken = (email: string, verified = true) => `h.${Buffer.from(JSON.stringify({ email, email_verified: verified })).toString('base64url')}.s`;

function body(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function startGoogle(): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    void (async () => {
      const raw = await body(req);
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.url === '/token') {
        const form = new URLSearchParams(raw.toString('utf8'));
        if (form.get('client_id') !== 'e2e-client' || form.get('client_secret') !== 'e2e-secret') return json(401, { error: 'invalid_client' });
        if (form.get('grant_type') === 'refresh_token') {
          if (google.revokedGrant || form.get('refresh_token') !== 'refresh-1') return json(400, { error: 'invalid_grant' });
          return json(200, { access_token: 'access-1', expires_in: 3599 });
        }
        google.redirectUris.push(form.get('redirect_uri') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        if (createHash('sha256').update(verifier).digest('base64url') !== google.challenge) return json(400, { error: 'invalid_grant' });
        const code = form.get('code');
        const grants: Record<string, { email: string; scope: string; verified?: boolean }> = {
          good: { email: 'mario@example.it', scope: `openid email ${SEND_SCOPE}` },
          stranger: { email: 'someone@gmail.com', scope: `openid email ${SEND_SCOPE}` },
          noscope: { email: 'mario@example.it', scope: 'openid email' },
        };
        const g = grants[code ?? ''];
        if (!g) return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'access-1', refresh_token: 'refresh-1', scope: g.scope, id_token: idToken(g.email, g.verified ?? true) });
      }
      if (req.url?.startsWith('/send')) {
        google.sends.push({ authorization: req.headers.authorization ?? '', contentType: String(req.headers['content-type']), raw: raw.toString('utf8') });
        if (google.sendStatus !== 200) return json(google.sendStatus, { error: { code: google.sendStatus, message: 'boom' } });
        return json(200, { id: `gmail-${google.sends.length}`, threadId: 't' });
      }
      if (req.url === '/revoke') {
        google.revoked.push(new URLSearchParams(raw.toString('utf8')).get('token') ?? '');
        return json(200, {});
      }
      return json(404, {});
    })();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

const GOOGLE_ENV = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_TOKEN_URL', 'GOOGLE_REVOKE_URL', 'GMAIL_SEND_URL'] as const;

describe('send from the user Gmail (OAuth)', () => {
  let server: Server;
  let ctx: TestCtx;

  beforeAll(async () => {
    let base: string;
    ({ server, base } = await startGoogle());
    Object.assign(process.env, {
      GOOGLE_OAUTH_CLIENT_ID: 'e2e-client',
      GOOGLE_OAUTH_CLIENT_SECRET: 'e2e-secret',
      GOOGLE_TOKEN_URL: `${base}/token`,
      GOOGLE_REVOKE_URL: `${base}/revoke`,
      GMAIL_SEND_URL: `${base}/send`,
      MAIL_MODE: 'resend', // real sending path; the Resend transport itself is captured by the test double
    });
    ctx = await createTestApp();
  });
  afterAll(async () => {
    process.env.MAIL_MODE = 'dry-run';
    for (const key of GOOGLE_ENV) delete process.env[key];
    await ctx.close();
    await new Promise<void>((r) => server.close(() => r()));
  });
  beforeEach(() => google.reset());

  async function newProfile(s: Awaited<ReturnType<typeof register>>, emails = ['mario@example.it']) {
    return (await authed(ctx, s).post('/profiles').send(profileInput({ emails })).expect(201)).body.id as string;
  }

  /** The whole browser round trip: ask for the Google URL, "consent", hand the code back to the app. */
  async function connect(s: Awaited<ReturnType<typeof register>>, id: string, code = 'good') {
    const api = authed(ctx, s);
    const { url } = (await api.post(`/profiles/${id}/sender/gmail/start`).expect(200)).body as { url: string };
    const params = new URL(url).searchParams;
    google.challenge = params.get('code_challenge') ?? '';
    return api.post('/sender/gmail/complete').send({ code, state: params.get('state') }).expect(200);
  }

  async function activate(s: Awaited<ReturnType<typeof register>>, id: string) {
    const api = authed(ctx, s);
    await api.post(`/profiles/${id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
    await api.post(`/profiles/${id}/activate`).expect(200);
  }

  it('is advertised in /config and the consent URL asks only for the send permission', async () => {
    expect((await ctx.http().get('/api/v1/config').expect(200)).body.features).toMatchObject({ senderSmtp: true, senderGmail: true });
    const s = await register(ctx);
    const id = await newProfile(s);
    const { url } = (await authed(ctx, s).post(`/profiles/${id}/sender/gmail/start`).expect(200)).body;
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')).toBe(`openid email ${SEND_SCOPE}`);
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:5173/app/collega-google');
    expect(u.searchParams.get('login_hint')).toBe('mario@example.it');
    await ctx.http().post(`/api/v1/profiles/${id}/sender/gmail/start`).expect(401);
  });

  it('connects the profile, proves PKCE to Google and never stores or returns the token in clear', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const id = await newProfile(s);

    const done = await connect(s, id);
    expect(done.body).toMatchObject({ profileId: id, sender: { mode: 'gmail', gmail: { email: 'mario@example.it' }, smtp: null, lastError: null } });
    expect(done.body.sender.verifiedAt).not.toBeNull();
    expect(google.redirectUris).toEqual(['http://localhost:5173/app/collega-google']);
    expect(JSON.stringify(done.body)).not.toContain('refresh-1');
    expect((await api.get(`/profiles/${id}`).expect(200)).body.senderMode).toBe('gmail');
    expect((await api.get(`/profiles/${id}/sender`).expect(200)).body).toMatchObject({ mode: 'gmail', gmail: { email: 'mario@example.it' } });
    expect(JSON.stringify(await ctx.connection.collection('profiles').find({}).toArray())).not.toContain('refresh-1');
  });

  it('sends the requests through the Gmail API from the user address, with the alias as Reply-To', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const id = await newProfile(s);
    await connect(s, id);
    await activate(s, id);
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    await ctx.scheduler.tick();

    expect(mailsForRef(ctx, acme.shortRef)).toHaveLength(0); // nothing went through the Cancellamy provider
    const mine = google.sends.filter((m) => m.raw.includes(acme.shortRef));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ authorization: 'Bearer access-1', contentType: 'message/rfc822' });
    expect(mine[0]!.raw).toMatch(/^From: "?Mario Rossi"? <mario@example\.it>/mi);
    expect(mine[0]!.raw).toMatch(/^To: privacy@acmeleads\.com/mi);
    expect(mine[0]!.raw).toMatch(/^Reply-To: r-[a-z0-9]+@in\.example\.org/mi);
    expect(mine[0]!.raw).toMatch(/^X-Cancellamy-Ref: CNC-/m);
    expect(mine[0]!.raw).not.toContain('delega.pdf'); // sent as the data subject: no delega
    expect(mine[0]!.raw.replace(/=\r?\n/g, '')).toContain('am the data subject'); // quoted-printable soft breaks removed; full text checked in own-mailbox.e2e-spec

    const d = await detail(ctx, s, acme.id);
    expect(d.status).toBe('sent');
    expect(d.dryRun).toBe(false);
    expect(d.messages[0]).toMatchObject({ direction: 'out', via: 'gmail', from: expect.stringContaining('mario@example.it') });
    expect((await api.get(`/profiles/${id}/sender`).expect(200)).body.lastError).toBeNull();
  });

  it('refuses tampered, foreign and expired authorizations, missing permission and addresses outside the profile', async () => {
    const s = await register(ctx);
    const other = await register(ctx);
    const api = authed(ctx, s);
    const id = await newProfile(s);
    const start = async () => {
      const params = new URL((await api.post(`/profiles/${id}/sender/gmail/start`).expect(200)).body.url).searchParams;
      google.challenge = params.get('code_challenge') ?? '';
      return params.get('state') as string;
    };

    const state = await start();
    expect((await api.post('/sender/gmail/complete').send({ code: 'good', state: 'garbage' }).expect(400)).body.code).toBe('GMAIL_AUTH_FAILED');
    expect((await authed(ctx, other).post('/sender/gmail/complete').send({ code: 'good', state }).expect(400)).body.message).toMatch(/another user/);
    await api.post('/sender/gmail/complete').send({ code: 'good' }).expect(400);

    const noScope = await api.post('/sender/gmail/complete').send({ code: 'noscope', state }).expect(400);
    expect(noScope.body).toMatchObject({ code: 'GMAIL_AUTH_FAILED', message: expect.stringMatching(/permission to send/) });

    const wrongCode = await api.post('/sender/gmail/complete').send({ code: 'unknown', state }).expect(400);
    expect(wrongCode.body.code).toBe('GMAIL_AUTH_FAILED');

    const stranger = await api.post('/sender/gmail/complete').send({ code: 'stranger', state }).expect(400);
    expect(stranger.body.code).toBe('GMAIL_ADDRESS_NOT_IN_PROFILE');
    expect(google.revoked).toEqual(['refresh-1']); // nothing is kept for an address that is not the user's
    expect((await api.get(`/profiles/${id}/sender`).expect(200)).body).toMatchObject({ mode: 'cancellamy', gmail: null });

    const stale = await start();
    ctx.clock.advance(11 * 60 * 1000);
    expect((await api.post('/sender/gmail/complete').send({ code: 'good', state: stale }).expect(400)).body.message).toMatch(/expired/);
    await authed(ctx, other).post(`/profiles/${id}/sender/gmail/start`).expect(404); // not their profile
  });

  it('waits and tells the user when Google access is revoked, then resumes after reconnecting', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const id = await newProfile(s);
    await connect(s, id);
    await activate(s, id);
    const acme = await requestByBroker(ctx, s, 'acme-leads');

    google.revokedGrant = true; // the user removed Cancellamy from their Google account
    await ctx.scheduler.tick();
    expect(google.sends).toHaveLength(0);
    expect((await api.get(`/profiles/${id}/sender`).expect(200)).body.lastError).toMatch(/revoked or expired/);
    expect((await detail(ctx, s, acme.id)).status).toBe('queued');
    const notes = (await api.get('/notifications').expect(200)).body.items;
    expect(notes.filter((n: { title: string }) => n.title.includes('casella di posta'))).toHaveLength(1);

    google.revokedGrant = false;
    await connect(s, id);
    expect((await api.get(`/profiles/${id}/sender`).expect(200)).body.lastError).toBeNull();
    await ctx.scheduler.tick();
    expect((await detail(ctx, s, acme.id)).status).toBe('sent');
    expect(google.sends.filter((m) => m.raw.includes(acme.shortRef))).toHaveLength(1);
  });

  it('keeps the request queued, without blaming the user, when Gmail has a temporary error', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const id = await newProfile(s);
    await connect(s, id);
    await activate(s, id);
    const acme = await requestByBroker(ctx, s, 'acme-leads');

    google.sendStatus = 503;
    await ctx.scheduler.tick();
    expect((await detail(ctx, s, acme.id)).status).toBe('queued');
    expect((await api.get(`/profiles/${id}/sender`).expect(200)).body.lastError).toBeNull();

    google.sendStatus = 200;
    ctx.clock.advance(24 * 60 * 60 * 1000);
    await ctx.scheduler.tick();
    expect((await detail(ctx, s, acme.id)).status).toBe('sent');
  });

  it('revokes the grant at Google when the user disconnects, switches to SMTP or deletes the profile', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);

    const a = await newProfile(s);
    await connect(s, a);
    const back = await api.del(`/profiles/${a}/sender`).expect(200);
    expect(back.body).toMatchObject({ mode: 'cancellamy', gmail: null, smtp: null });
    expect(google.revoked).toEqual(['refresh-1']);
    const stored = await ctx.connection.collection('profiles').findOne({ _id: new Types.ObjectId(a) });
    expect(stored).toMatchObject({ senderMode: 'cancellamy' });
    expect(stored).not.toHaveProperty('gmailEnc');

    const b = await newProfile(s);
    await connect(s, b);
    await api.del(`/profiles/${b}`).expect(204);
    expect(google.revoked).toEqual(['refresh-1', 'refresh-1']);
  });

  it('revokes the grants of every profile when the account is deleted', async () => {
    const s = await register(ctx, uniqueEmail('gmail-owner'));
    const id = await newProfile(s);
    await connect(s, id);
    await authed(ctx, s).del('/me').send({ password: 'correct-horse-battery' }).expect(204);
    expect(google.revoked).toEqual(['refresh-1']);
  });
});

describe('Gmail connection switches', () => {
  it('is hidden and answers 404 FEATURE_DISABLED when the instance has no Google credentials', async () => {
    const saved = Object.fromEntries(GOOGLE_ENV.map((k) => [k, process.env[k]]));
    for (const key of GOOGLE_ENV) delete process.env[key];
    const ctx = await createTestApp();
    try {
      expect((await ctx.http().get('/api/v1/config').expect(200)).body.features).toMatchObject({ senderSmtp: true, senderGmail: false });
      const s = await register(ctx);
      const id = (await authed(ctx, s).post('/profiles').send(profileInput({ emails: ['mario@example.it'] })).expect(201)).body.id as string;
      expect((await authed(ctx, s).post(`/profiles/${id}/sender/gmail/start`).expect(404)).body.code).toBe('FEATURE_DISABLED');
      expect((await authed(ctx, s).post('/sender/gmail/complete').send({ code: 'c', state: 's' }).expect(404)).body.code).toBe('FEATURE_DISABLED');
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
      await ctx.close();
    }
  });

  it('is switched off together with the sender feature', async () => {
    process.env.FEATURES_DISABLED = 'sender';
    Object.assign(process.env, { GOOGLE_OAUTH_CLIENT_ID: 'e2e-client', GOOGLE_OAUTH_CLIENT_SECRET: 'e2e-secret' });
    const ctx = await createTestApp();
    try {
      expect((await ctx.http().get('/api/v1/config').expect(200)).body.features).toMatchObject({ senderSmtp: false, senderGmail: false });
      const s = await register(ctx);
      await authed(ctx, s).post('/sender/gmail/complete').send({ code: 'c', state: 's' }).expect(404);
    } finally {
      delete process.env.FEATURES_DISABLED;
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      await ctx.close();
    }
  });
});

describe('Gmail in dry-run mode', () => {
  it('never talks to Google: requests are only recorded', async () => {
    const { server, base } = await startGoogle();
    Object.assign(process.env, {
      GOOGLE_OAUTH_CLIENT_ID: 'e2e-client',
      GOOGLE_OAUTH_CLIENT_SECRET: 'e2e-secret',
      GOOGLE_TOKEN_URL: `${base}/token`,
      GOOGLE_REVOKE_URL: `${base}/revoke`,
      GMAIL_SEND_URL: `${base}/send`,
      MAIL_MODE: 'dry-run',
    });
    google.reset();
    const ctx = await createTestApp();
    try {
      const s = await register(ctx);
      const api = authed(ctx, s);
      const id = (await api.post('/profiles').send(profileInput({ emails: ['mario@example.it'] })).expect(201)).body.id as string;
      const params = new URL((await api.post(`/profiles/${id}/sender/gmail/start`).expect(200)).body.url).searchParams;
      google.challenge = params.get('code_challenge') ?? '';
      await api.post('/sender/gmail/complete').send({ code: 'good', state: params.get('state') }).expect(200);
      await api.post(`/profiles/${id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
      await api.post(`/profiles/${id}/activate`).expect(200);
      const acme = await requestByBroker(ctx, s, 'acme-leads');
      await ctx.scheduler.tick();

      expect(google.sends).toHaveLength(0);
      const d = await detail(ctx, s, acme.id);
      expect(d.dryRun).toBe(true);
      expect(d.messages[0]).toMatchObject({ direction: 'out', via: 'dry-run' });
    } finally {
      for (const key of GOOGLE_ENV) delete process.env[key];
      await ctx.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
