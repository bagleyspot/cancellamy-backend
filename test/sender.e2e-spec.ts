import { SMTPServer } from 'smtp-server';
import { AddressInfo } from 'net';
import { DAY, TestCtx, authed, createTestApp, detail, listRequests, mailsForRef, profileInput, register, requestByBroker } from './helpers';

interface Received {
  raw: string;
  from: string;
}

function startSmtp(state: { password: string; authAttempts: number; messages: Received[] }): Promise<{ server: SMTPServer; port: number }> {
  const server = new SMTPServer({
    authOptional: false,
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    logger: false,
    onAuth(auth, _session, cb) {
      state.authAttempts += 1;
      if (auth.username === 'mario@example.it' && auth.password === state.password) cb(null, { user: 'mario' });
      else cb(new Error('Invalid login'));
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        state.messages.push({ raw: Buffer.concat(chunks).toString('utf8'), from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '' });
        cb();
      });
    },
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.server.address() as AddressInfo).port })));
}

const smtpBody = (port: number, password = 'app-password-1', overrides: Record<string, unknown> = {}) => ({
  mode: 'smtp',
  smtp: { host: '127.0.0.1', port, secure: false, username: 'mario@example.it', password, fromAddress: 'mario@example.it', ...overrides },
});

const profileWithMailbox = () => profileInput({ emails: ['mario@example.it'] });

describe('send from the user mailbox (SMTP)', () => {
  const smtp = { password: 'app-password-1', authAttempts: 0, messages: [] as Received[] };
  let server: SMTPServer;
  let port: number;
  let ctx: TestCtx;

  beforeAll(async () => {
    ({ server, port } = await startSmtp(smtp));
    process.env.MAIL_MODE = 'resend'; // real sending path; the Resend transport itself is captured by the test double
    ctx = await createTestApp();
  });
  afterAll(async () => {
    process.env.MAIL_MODE = 'dry-run';
    await ctx.close();
    await new Promise<void>((r) => server.close(() => r()));
  });
  beforeEach(() => {
    smtp.password = 'app-password-1';
    smtp.messages.length = 0;
  });

  async function newProfile(s: Awaited<ReturnType<typeof register>>) {
    const api = authed(ctx, s);
    const created = await api.post('/profiles').send(profileWithMailbox()).expect(201);
    return created.body.id as string;
  }

  it('validates and stores the settings without ever returning the password', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const id = await newProfile(s);
    expect((await api.get(`/profiles/${id}/sender`).expect(200)).body).toMatchObject({ mode: 'cancellamy', smtp: null, verifiedAt: null });

    const wrong = await api.put(`/profiles/${id}/sender`).send(smtpBody(port, 'wrong-password')).expect(400);
    expect(wrong.body.code).toBe('SMTP_CONNECTION_FAILED');
    expect(wrong.body.message).toMatch(/Credenziali non accettate/);
    const stranger = await api.put(`/profiles/${id}/sender`).send(smtpBody(port, 'app-password-1', { fromAddress: 'someone@else.it' })).expect(400);
    expect(stranger.body.code).toBe('VALIDATION_ERROR');
    await api.put(`/profiles/${id}/sender`).send({ mode: 'smtp' }).expect(400);
    await api.put(`/profiles/${id}/sender`).send(smtpBody(port, 'app-password-1', { port: 99999 })).expect(400);

    const ok = await api.put(`/profiles/${id}/sender`).send(smtpBody(port)).expect(200);
    expect(ok.body).toMatchObject({ mode: 'smtp', lastError: null, smtp: { host: '127.0.0.1', port, secure: false, username: 'mario@example.it', fromAddress: 'mario@example.it' } });
    expect(ok.body.verifiedAt).not.toBeNull();
    expect(ok.body.replyAddress).toMatch(/^r-[a-z0-9]+@in\.example\.org$/);
    expect(JSON.stringify(ok.body)).not.toContain('app-password-1');
    expect((await api.get(`/profiles/${id}`).expect(200)).body.senderMode).toBe('smtp');

    const raw = await ctx.connection.collection('profiles').findOne({});
    expect(JSON.stringify(await ctx.connection.collection('profiles').find({}).toArray())).not.toContain('app-password-1');
    expect(raw).toBeTruthy();

    expect((await api.post(`/profiles/${id}/sender/test`).send({}).expect(200)).body).toEqual({ ok: true });
    await api.post(`/profiles/${id}/sender/test`).send({ smtp: smtpBody(port, 'nope').smtp }).expect(400);
    expect(smtp.messages).toHaveLength(0); // the test never sends anything
  });

  it("sends the requests from the user's address with the alias as Reply-To, and stores how", async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const id = await newProfile(s);
    await api.put(`/profiles/${id}/sender`).send(smtpBody(port)).expect(200);
    await api.post(`/profiles/${id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
    await api.post(`/profiles/${id}/activate`).expect(200);
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    await ctx.scheduler.tick();

    expect(mailsForRef(ctx, acme.shortRef)).toHaveLength(0); // nothing went through the Cancellamy provider
    const mine = smtp.messages.filter((m) => m.raw.includes(acme.shortRef));
    expect(mine).toHaveLength(1);
    const raw = mine[0]!.raw;
    expect(raw).toMatch(/^From: "?Mario Rossi"? <mario@example\.it>/mi);
    expect(raw).toMatch(/^To: privacy@acmeleads\.com/mi);
    expect(raw).toMatch(/^Reply-To: r-[a-z0-9]+@in\.example\.org/mi);
    expect(raw).toMatch(/^X-Cancellamy-Ref: CNC-/m);
    expect(raw).toMatch(/Message-ID: <[^@]+@example\.it>/i);
    expect(raw).toContain('delega.pdf');
    expect(mine[0]!.from).toBe('mario@example.it');

    const d = await detail(ctx, s, acme.id);
    expect(d.status).toBe('sent');
    expect(d.dryRun).toBe(false);
    expect(d.messages[0]).toMatchObject({ direction: 'out', via: 'smtp', from: expect.stringContaining('mario@example.it') });
  });

  it('waits and tells the user when the mailbox rejects the credentials, then resumes after a fix', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const id = await newProfile(s);
    await api.put(`/profiles/${id}/sender`).send(smtpBody(port)).expect(200);
    await api.post(`/profiles/${id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
    await api.post(`/profiles/${id}/activate`).expect(200);
    const acme = await requestByBroker(ctx, s, 'acme-leads');

    smtp.password = 'rotated-password'; // the user changed the app password at the provider
    await ctx.scheduler.tick();
    expect(smtp.messages.filter((m) => m.raw.includes(acme.shortRef))).toHaveLength(0);
    const sender = (await api.get(`/profiles/${id}/sender`).expect(200)).body;
    expect(sender.lastError).toMatch(/rejected the credentials/);
    expect((await detail(ctx, s, acme.id)).status).toBe('queued');
    const notes = (await api.get('/notifications').expect(200)).body.items;
    expect(notes.filter((n: { title: string }) => n.title.includes('casella di posta'))).toHaveLength(1);

    // Still broken: the profile is skipped (no hammering of the mailbox) and the user is not notified again.
    const attempts = smtp.authAttempts;
    ctx.clock.advance(2 * 60 * 60 * 1000);
    await ctx.scheduler.tick();
    expect(smtp.authAttempts).toBe(attempts);
    expect((await api.get('/notifications').expect(200)).body.items.filter((n: { title: string }) => n.title.includes('casella di posta'))).toHaveLength(1);

    await api.put(`/profiles/${id}/sender`).send(smtpBody(port, 'rotated-password')).expect(200);
    expect((await api.get(`/profiles/${id}/sender`).expect(200)).body.lastError).toBeNull();
    await ctx.scheduler.tick();
    expect((await detail(ctx, s, acme.id)).status).toBe('sent');
    expect(smtp.messages.filter((m) => m.raw.includes(acme.shortRef))).toHaveLength(1);
    expect((await listRequests(ctx, s)).items.every((r) => r.status !== 'queued')).toBe(true);
  });

  it('can go back to Cancellamy and sends reminders with the same mailbox', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const id = await newProfile(s);
    await api.put(`/profiles/${id}/sender`).send(smtpBody(port)).expect(200);
    await api.post(`/profiles/${id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
    await api.post(`/profiles/${id}/activate`).expect(200);
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    await ctx.scheduler.tick();
    ctx.clock.advance(31 * DAY);
    await ctx.scheduler.tick(); // overdue + automatic reminder through the same mailbox
    expect(smtp.messages.filter((m) => m.raw.includes(acme.shortRef))).toHaveLength(2);
    expect(smtp.messages.filter((m) => m.raw.includes(acme.shortRef))[1]!.raw).toMatch(/Reminder no\. 1/);

    const back = await api.del(`/profiles/${id}/sender`).expect(200);
    expect(back.body).toMatchObject({ mode: 'cancellamy', smtp: null });
    expect((await api.get(`/profiles/${id}`).expect(200)).body.senderMode).toBe('cancellamy');
  });
});

describe('SMTP safety and switches', () => {
  it('refuses private hosts and unusual ports when private hosts are not allowed (SSRF)', async () => {
    process.env.SMTP_ALLOW_PRIVATE_HOSTS = 'false';
    const ctx = await createTestApp();
    try {
      const s = await register(ctx);
      const api = authed(ctx, s);
      const { body } = await api.post('/profiles').send(profileWithMailbox()).expect(201);
      const attempt = (host: string, port = 587) =>
        api.put(`/profiles/${body.id}/sender`).send({ mode: 'smtp', smtp: { host, port, secure: false, username: 'u', password: 'p', fromAddress: 'mario@example.it' } });
      for (const host of ['127.0.0.1', 'localhost', '10.0.0.5', '192.168.0.10', '169.254.169.254', '172.16.5.5']) {
        const res = await attempt(host).expect(400);
        expect(res.body.code).toBe('SMTP_HOST_NOT_ALLOWED');
      }
      expect((await attempt('::1').expect(400)).body.code).toBe('VALIDATION_ERROR'); // IPv6 literals are not accepted as hosts
      expect((await attempt('smtp.example.com', 22).expect(400)).body.code).toBe('SMTP_HOST_NOT_ALLOWED');
      expect((await attempt('smtp.example.com', 6379).expect(400)).body.code).toBe('SMTP_HOST_NOT_ALLOWED');
    } finally {
      process.env.SMTP_ALLOW_PRIVATE_HOSTS = 'true';
      await ctx.close();
    }
  });

  it('never talks to the mail server in dry-run mode', async () => {
    const smtp = { password: 'app-password-1', authAttempts: 0, messages: [] as Received[] };
    const { server, port } = await startSmtp(smtp);
    const ctx = await createTestApp(); // MAIL_MODE=dry-run
    try {
      const s = await register(ctx);
      const api = authed(ctx, s);
      const created = await api.post('/profiles').send(profileWithMailbox()).expect(201);
      await api.put(`/profiles/${created.body.id}/sender`).send(smtpBody(port)).expect(200);
      const attemptsAfterSetup = smtp.authAttempts;
      await api.post(`/profiles/${created.body.id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
      await api.post(`/profiles/${created.body.id}/activate`).expect(200);
      const acme = await requestByBroker(ctx, s, 'acme-leads');
      await ctx.scheduler.tick();
      expect(smtp.messages).toHaveLength(0);
      expect(smtp.authAttempts).toBe(attemptsAfterSetup);
      const d = await detail(ctx, s, acme.id);
      expect(d).toMatchObject({ status: 'sent', dryRun: true });
      expect(d.messages[0]).toMatchObject({ via: 'dry-run' });
      expect(d.messages[0].from).toContain('mario@example.it');
    } finally {
      await ctx.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('can be switched off by the operator', async () => {
    process.env.FEATURES_DISABLED = 'sender';
    const ctx = await createTestApp();
    try {
      expect((await ctx.http().get('/api/v1/config').expect(200)).body.features.senderSmtp).toBe(false);
      const s = await register(ctx);
      const { body } = await authed(ctx, s).post('/profiles').send(profileWithMailbox()).expect(201);
      const res = await authed(ctx, s).get(`/profiles/${body.id}/sender`).expect(404);
      expect(res.body.code).toBe('FEATURE_DISABLED');
    } finally {
      delete process.env.FEATURES_DISABLED;
      await ctx.close();
    }
  });
});
