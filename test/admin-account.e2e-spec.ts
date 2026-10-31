import { Types } from 'mongoose';
import { BrokerVerifierService } from '../src/brokers/broker-verifier.service';
import { RequestEngine } from '../src/requests/request-engine';
import { PASSWORD, TestCtx, activeProfile, authed, createTestApp, detail, listRequests, mailsForRef, register, requestByBroker, Session } from './helpers';

describe('admin area', () => {
  let ctx: TestCtx;
  let admin: Session;
  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await register(ctx, 'admin@example.org');
  });
  afterAll(() => ctx.close());

  it('is restricted to admins', async () => {
    const user = await register(ctx);
    for (const path of ['/admin/stats', '/admin/brokers', '/admin/outbox', '/admin/inbound-unmatched']) {
      await authed(ctx, user).get(path).expect(403);
      await ctx.http().get(`/api/v1${path}`).expect(401);
    }
    await authed(ctx, user).patch('/admin/brokers/acme-leads').send({ sendEnabled: false }).expect(403);
    await authed(ctx, user).post('/admin/brokers/reseed').expect(403);
    await authed(ctx, user).post('/admin/brokers/auto-verify').send({}).expect(403);
  });

  it('shows platform stats and the outbox with decrypted subjects', async () => {
    const user = await register(ctx);
    await activeProfile(ctx, user);
    await ctx.scheduler.tick();
    const stats = (await authed(ctx, admin).get('/admin/stats').expect(200)).body;
    expect(stats).toMatchObject({ mailMode: 'dry-run' });
    expect(stats.users).toBeGreaterThanOrEqual(2);
    expect(stats.activeProfiles).toBeGreaterThanOrEqual(1);
    expect(stats.messagesOut).toBeGreaterThanOrEqual(2);
    expect(stats.requestsByStatus.some((s: { status: string }) => s.status === 'sent')).toBe(true);
    const outbox = (await authed(ctx, admin).get('/admin/outbox?limit=5').expect(200)).body;
    expect(outbox.items.length).toBeLessThanOrEqual(5);
    expect(outbox.items[0]).toMatchObject({ dryRun: true });
    expect(outbox.items[0].subject).toMatch(/\[CNC-/);
    expect(outbox.items[0].providerId).toMatch(/^dry_|^cap_/);
  });

  it('edits brokers, feeds active profiles with newly enabled ones and survives a reseed', async () => {
    const user = await register(ctx);
    await activeProfile(ctx, user);
    const api = authed(ctx, admin);
    expect((await listRequests(ctx, user)).total).toBe(4);

    const bad = await api.patch('/admin/brokers/not-yet').send({ verificationStatus: 'bogus' }).expect(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    await api.patch('/admin/brokers/missing').send({ sendEnabled: true }).expect(404);
    await api.patch('/admin/brokers/not-yet').send({ markets: ['Italy'] }).expect(400);
    const patched = (await api.patch('/admin/brokers/not-yet').send({ sendEnabled: true, verificationStatus: 'verified', markets: ['it'], notes: 'checked by hand', channels: [{ type: 'email', value: 'dpo@daverificare.com', verified: true }] }).expect(200)).body;
    expect(patched).toMatchObject({ sendEnabled: true, verificationStatus: 'verified', notes: 'checked by hand' });
    expect(patched.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await ctx.scheduler.tick(); // syncNewBrokers
    const created = await requestByBroker(ctx, user, 'not-yet');
    expect(created).toMatchObject({ channel: 'email', cycle: 1 });
    await ctx.scheduler.tick();
    expect(mailsForRef(ctx, created.shortRef)[0]?.to).toEqual(['dpo@daverificare.com']);
    // idempotent: another tick does not duplicate
    await ctx.scheduler.tick();
    expect((await listRequests(ctx, user)).items.filter((r) => r.broker.id === 'not-yet')).toHaveLength(1);

    const reseed = (await api.post('/admin/brokers/reseed').expect(201)).body;
    expect(reseed).toEqual({ created: 0, updated: 7 });
    const after = (await ctx.http().get('/api/v1/brokers/not-yet').expect(200)).body;
    expect(after).toMatchObject({ sendEnabled: true, verificationStatus: 'verified', notes: 'checked by hand' });
    expect((await ctx.connection.collection('brokers').findOne({ slug: 'not-yet' }))?.markets).toEqual(['IT']); // admin classification survives the reseed
    const adminList = (await api.get('/admin/brokers?status=verified&limit=2&page=1').expect(200)).body;
    expect(adminList.limit).toBe(2);
    expect(adminList.items.length).toBeLessThanOrEqual(2);
    // Restore the shared fixture so later tests in this file see the original catalogue.
    await api.patch('/admin/brokers/not-yet').send({ sendEnabled: false, verificationStatus: 'third_party', markets: [] }).expect(200);
  });

  it('auto-verifies unverified brokers with valid MX records via admin endpoint', async () => {
    const api = authed(ctx, admin);
    const verifier = ctx.app.get(BrokerVerifierService);
    verifier.setResolvers({
      mxResolver: async (domain) => domain === 'daverificare.com',
      htmlFetcher: async () => null,
    });

    // Clear adminEdited on not-yet via reseed so auto-verify can process it
    await (ctx.app.get('BrokerModel' as never) as { updateOne: (q: object, u: object) => Promise<unknown> }).updateOne(
      { slug: 'not-yet' },
      { $set: { adminEdited: [], verificationStatus: 'third_party', sendEnabled: false } },
    );

    const res = (await api.post('/admin/brokers/auto-verify').send({ crawlWebsites: false }).expect(201)).body;
    expect(res).toMatchObject({ checked: 1, promoted: 1, discovered: 0, sendable: 5 });

    // Restore fixture state
    await (ctx.app.get('BrokerModel' as never) as { updateOne: (q: object, u: object) => Promise<unknown> }).updateOne(
      { slug: 'not-yet' },
      { $set: { adminEdited: [], verificationStatus: 'third_party', sendEnabled: false } },
    );
  });
});

describe('account data rights', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('exports every personal datum decrypted, and deletes the account with all related data', async () => {
    const s = await register(ctx);
    const { id } = await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    await authed(ctx, s).post(`/requests/${acme.id}/simulate-reply`).send({ kind: 'refused' }).expect(200);

    const res = await authed(ctx, s).get('/me/export').expect(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const data = JSON.parse(res.text);
    expect(data.user.email).toBe(s.email);
    expect(data.profiles[0].data).toMatchObject({ firstName: 'Mario', fiscalCode: 'RSSMRA85C12F205Z', emails: ['mario.rossi@example.it'] });
    expect(data.authorizations[0].signatureName).toBe('Mario Rossi');
    expect(data.requests).toHaveLength(4);
    expect(data.messages.some((m: { direction: string; text: string }) => m.direction === 'in' && m.text.includes('obbligo di legge'))).toBe(true);
    expect(JSON.stringify(data)).not.toContain('passwordHash');

    const uid = new Types.ObjectId(s.userId);
    await authed(ctx, s).del('/me').send({ password: 'wrong-password-1' }).expect(400);
    await authed(ctx, s).del('/me').send({ password: PASSWORD }).expect(204);
    for (const c of ['users', 'profiles', 'authorizations', 'removalrequests', 'messages', 'notifications', 'reports', 'sessions']) {
      const filter = c === 'users' ? { _id: uid } : { userId: uid };
      expect(await ctx.connection.collection(c).countDocuments(filter)).toBe(0);
    }
    await authed(ctx, s).get('/me').expect(401);
    await authed(ctx, s).get(`/profiles/${id}`).expect(401);
    await ctx.http().post('/api/v1/auth/login').send({ email: s.email, password: PASSWORD }).expect(401);
    await ctx.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(401);
    const again = await register(ctx, s.email); // the address can be reused
    expect(again.userId).not.toBe(s.userId);
  });
});

describe('operations', () => {
  it('never sends a request twice when two instances tick concurrently', async () => {
    const a = await createTestApp();
    const b = await createTestApp(); // same database, separate process-like instance
    try {
      const users = [await register(a), await register(a), await register(a)];
      for (const u of users) await activeProfile(a, u);
      const [r1, r2] = await Promise.all([a.scheduler.tick(), b.scheduler.tick()]);
      expect([r1.ran, r2.ran].filter(Boolean)).toHaveLength(1); // the lease admits a single runner
      const refs = new Set<string>();
      for (const u of users) for (const r of (await listRequests(a, u)).items.filter((x) => x.channel === 'email')) refs.add(r.shortRef);
      expect(refs.size).toBe(6);
      for (const ref of refs) expect(mailsForRef(a, ref).length + mailsForRef(b, ref).length).toBe(1);

      // Even without the lease, atomic claims never hand the same request to two workers.
      const extra = await register(a);
      await activeProfile(a, extra);
      const mine = (await listRequests(a, extra)).items.filter((x) => x.channel === 'email').map((x) => x.id as string);
      const [c1, c2] = await Promise.all([a.app.get(RequestEngine).claimQueued(100), b.app.get(RequestEngine).claimQueued(100)]);
      const ids = [...c1, ...c2].map((r) => String(r._id));
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of mine) expect(ids).toContain(id);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('exposes the cron endpoint only with the shared secret', async () => {
    process.env.CRON_SECRET = 'cron-secret-for-tests';
    const ctx = await createTestApp();
    try {
      await ctx.http().post('/internal/cron/tick').expect(401);
      await ctx.http().post('/internal/cron/tick').set('x-cron-secret', 'wrong').expect(401);
      const ok = await ctx.http().post('/internal/cron/tick').set('x-cron-secret', 'cron-secret-for-tests').expect(200);
      expect(ok.body).toMatchObject({ ran: true });
      await ctx.http().post('/api/v1/internal/cron/tick').set('x-cron-secret', 'cron-secret-for-tests').expect(404);
    } finally {
      delete process.env.CRON_SECRET;
      await ctx.close();
    }
    const closed = await createTestApp();
    try {
      await closed.http().post('/internal/cron/tick').set('x-cron-secret', 'anything').expect(404);
    } finally {
      await closed.close();
    }
  });

  it('refuses simulated replies and flags real sending when MAIL_MODE=resend', async () => {
    process.env.MAIL_MODE = 'resend';
    const ctx = await createTestApp();
    try {
      expect((await ctx.http().get('/api/v1/config').expect(200)).body.mailMode).toBe('resend');
      const s = await register(ctx);
      await activeProfile(ctx, s);
      await ctx.scheduler.tick();
      const acme = await requestByBroker(ctx, s, 'acme-leads');
      expect((await detail(ctx, s, acme.id)).canSimulateReply).toBe(false);
      const res = await authed(ctx, s).post(`/requests/${acme.id}/simulate-reply`).send({ kind: 'completed' }).expect(403);
      expect(res.body.code).toBe('SIMULATION_DISABLED');
    } finally {
      process.env.MAIL_MODE = 'dry-run';
      await ctx.close();
    }
  });

  it('rejects malformed payloads and oversize bodies consistently', async () => {
    const ctx = await createTestApp();
    try {
      const res = await ctx.http().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":').expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      await ctx.http().post('/api/v1/auth/login').send({ email: 'a@b.it', password: 'x'.repeat(200) }).expect(400);
      const notFound = await ctx.http().get('/api/v1/does-not-exist').expect(404);
      expect(notFound.body.statusCode).toBe(404);
      expect((await ctx.http().options('/api/v1/me').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'GET')).headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect((await ctx.http().options('/api/v1/me').set('Origin', 'http://evil.example').set('Access-Control-Request-Method', 'GET')).headers['access-control-allow-origin']).toBeUndefined();
      expect((await ctx.http().get('/health')).headers['x-powered-by']).toBeUndefined();
    } finally {
      await ctx.close();
    }
  });
});
