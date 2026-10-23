import { PASSWORD, TestCtx, authed, cookieFrom, createTestApp, register, tokenFromMail, uniqueEmail, verifyEmail } from './helpers';

describe('health, config and public registry', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('exposes liveness and readiness without the API prefix', async () => {
    await ctx.http().get('/health').expect(200, { status: 'ok' });
    await ctx.http().get('/health/ready').expect(200, { status: 'ok', mongo: 'up' });
  });

  it('serves the public config with the dry-run flag', async () => {
    const res = await ctx.http().get('/api/v1/config').expect(200);
    expect(res.body).toMatchObject({ mailMode: 'dry-run', maxProfiles: 3, registryEntries: 7, sendableBrokers: 4 });
  });

  it('lists, filters and shows brokers publicly', async () => {
    const all = await ctx.http().get('/api/v1/brokers').expect(200);
    expect(all.body.total).toBe(7);
    const filtered = await ctx.http().get('/api/v1/brokers?category=business_info').expect(200);
    expect(filtered.body.items.map((b: { id: string }) => b.id)).toEqual(['infoitalia']);
    expect((await ctx.http().get('/api/v1/brokers?q=acme').expect(200)).body.total).toBe(1);
    expect((await ctx.http().get('/api/v1/brokers?sendable=true').expect(200)).body.total).toBe(4);
    const one = await ctx.http().get('/api/v1/brokers/acme-leads').expect(200);
    expect(one.body).toMatchObject({ name: 'Acme Leads Inc.', verificationStatus: 'verified', sendEnabled: true });
    await ctx.http().get('/api/v1/brokers/nope').expect(404);
    await ctx.http().get('/api/v1/brokers?category=bogus').expect(400);
    const stats = await ctx.http().get('/api/v1/brokers/stats').expect(200);
    expect(stats.body).toMatchObject({ total: 7, sendable: 4, italySpecific: 5 });
  });

  it('keeps credit bureaus and the regulator out of automatic sending', async () => {
    for (const id of ['garante', 'credit-bureau', 'not-yet']) {
      expect((await ctx.http().get(`/api/v1/brokers/${id}`).expect(200)).body.sendEnabled).toBe(false);
    }
  });
});

describe('authentication', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('registers, sets the httpOnly refresh cookie and sends a verification email', async () => {
    const email = uniqueEmail();
    const res = await ctx.http().post('/api/v1/auth/register').send({ email, password: PASSWORD, acceptTerms: true }).expect(201);
    expect(res.body.user).toMatchObject({ email, role: 'user', emailVerified: false, maxProfiles: 3 });
    expect(typeof res.body.accessToken).toBe('string');
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0] as string;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(ctx.mail.to(email)[0]?.subject).toMatch(/Conferma/);
  });

  it('validates input and rejects duplicates', async () => {
    const email = uniqueEmail();
    const bad = await ctx.http().post('/api/v1/auth/register').send({ email: 'nope', password: 'short', acceptTerms: false }).expect(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(bad.body.message)).toBe(true);
    await ctx.http().post('/api/v1/auth/register').send({ email, password: PASSWORD, acceptTerms: true, role: 'admin' }).expect(400);
    await ctx.http().post('/api/v1/auth/register').send({ email, password: PASSWORD, acceptTerms: true }).expect(201);
    const dup = await ctx.http().post('/api/v1/auth/register').send({ email: email.toUpperCase(), password: PASSWORD, acceptTerms: true }).expect(409);
    expect(dup.body.code).toBe('EMAIL_TAKEN');
  });

  it('logs in, rejects wrong credentials generically and returns the user on /me', async () => {
    const s = await register(ctx);
    const wrong = await ctx.http().post('/api/v1/auth/login').send({ email: s.email, password: 'wrong-password-1' }).expect(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    const unknown = await ctx.http().post('/api/v1/auth/login').send({ email: uniqueEmail('ghost'), password: PASSWORD }).expect(401);
    expect(unknown.body.message).toBe(wrong.body.message);
    const ok = await ctx.http().post('/api/v1/auth/login').send({ email: s.email, password: PASSWORD }).expect(200);
    const me = await ctx.http().get('/api/v1/me').set('Authorization', `Bearer ${ok.body.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ email: s.email, emailVerified: true });
  });

  it('protects endpoints without or with a bad token', async () => {
    await ctx.http().get('/api/v1/me').expect(401);
    await ctx.http().get('/api/v1/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
    await ctx.http().get('/api/v1/requests').expect(401);
    await ctx.http().get('/api/v1/profiles').expect(401);
  });

  it('verifies email with a token and rejects bad or reused tokens', async () => {
    const s = await register(ctx, uniqueEmail(), false);
    expect((await authed(ctx, s).get('/me')).body.emailVerified).toBe(false);
    await ctx.http().post('/api/v1/auth/verify-email').send({ token: 'bogus' }).expect(400);
    const token = tokenFromMail(ctx, s.email, 'verifica-email');
    await ctx.http().post('/api/v1/auth/verify-email').send({ token }).expect(204);
    expect((await authed(ctx, s).get('/me')).body.emailVerified).toBe(true);
    const reuse = await ctx.http().post('/api/v1/auth/verify-email').send({ token }).expect(400);
    expect(reuse.body.code).toBe('INVALID_TOKEN');
  });

  it('resends the verification email', async () => {
    const s = await register(ctx, uniqueEmail(), false);
    const before = ctx.mail.to(s.email).length;
    await authed(ctx, s).post('/auth/resend-verification').expect(204);
    expect(ctx.mail.to(s.email).length).toBe(before + 1);
    await verifyEmail(ctx, s);
  });

  it('rotates the refresh token and survives the benign two-tab race', async () => {
    const s = await register(ctx);
    const r1 = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(200);
    const cookie2 = cookieFrom(r1);
    expect(cookie2).not.toBe(s.cookie);
    expect(typeof r1.body.accessToken).toBe('string');
    // The old token reused immediately (another tab) still yields an access token but no new cookie.
    const race = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(200);
    expect(race.headers['set-cookie']).toBeUndefined();
    await ctx.http().post('/api/v1/auth/refresh').set('Cookie', cookie2).expect(200);
  });

  it('detects refresh-token theft: reuse after the grace window revokes the whole family', async () => {
    const s = await register(ctx);
    const r1 = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(200);
    const newest = cookieFrom(r1);
    ctx.clock.advance(60_000);
    await ctx.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(401);
    await ctx.http().post('/api/v1/auth/refresh').set('Cookie', newest).expect(401);
  });

  it('rejects refresh without a cookie and clears it on logout', async () => {
    await ctx.http().post('/api/v1/auth/refresh').expect(401);
    const s = await register(ctx);
    const res = await ctx.http().post('/api/v1/auth/logout').set('Cookie', s.cookie).expect(204);
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/cnc_rt=;/);
    await ctx.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(401);
  });

  it('runs the password reset flow and revokes sessions', async () => {
    const s = await register(ctx);
    await ctx.http().post('/api/v1/auth/forgot-password').send({ email: uniqueEmail('nobody') }).expect(204);
    await ctx.http().post('/api/v1/auth/forgot-password').send({ email: s.email }).expect(204);
    const token = tokenFromMail(ctx, s.email, 'reimposta-password');
    await ctx.http().post('/api/v1/auth/reset-password').send({ token, password: 'short' }).expect(400);
    await ctx.http().post('/api/v1/auth/reset-password').send({ token, password: 'a-brand-new-password' }).expect(204);
    await ctx.http().post('/api/v1/auth/reset-password').send({ token, password: 'another-password-12' }).expect(400);
    await ctx.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(401);
    await ctx.http().post('/api/v1/auth/login').send({ email: s.email, password: PASSWORD }).expect(401);
    await ctx.http().post('/api/v1/auth/login').send({ email: s.email, password: 'a-brand-new-password' }).expect(200);
  });

  it('locks the account after repeated failures without revealing it', async () => {
    const s = await register(ctx);
    for (let i = 0; i < 10; i++) {
      await ctx.http().post('/api/v1/auth/login').send({ email: s.email, password: 'wrong-wrong-12' }).expect(401);
    }
    const locked = await ctx.http().post('/api/v1/auth/login').send({ email: s.email, password: PASSWORD }).expect(401);
    expect(locked.body.code).toBe('INVALID_CREDENTIALS');
    ctx.clock.advance(16 * 60 * 1000);
    await ctx.http().post('/api/v1/auth/login').send({ email: s.email, password: PASSWORD }).expect(200);
  });

  it('updates settings and changes the password (keeping the current session)', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const upd = await api.patch('/me').send({ settings: { notifyByEmail: false } }).expect(200);
    expect(upd.body.settings).toEqual({ notifyByEmail: false, monthlyReport: true });
    await api.patch('/me').send({ settings: { notifyByEmail: 'yes' } }).expect(400);
    await api.post('/me/change-password').set('Cookie', s.cookie).send({ currentPassword: 'nope-nope-nope', newPassword: 'a-new-long-password' }).expect(400);
    await api.post('/me/change-password').set('Cookie', s.cookie).send({ currentPassword: PASSWORD, newPassword: 'a-new-long-password' }).expect(204);
    await ctx.http().post('/api/v1/auth/refresh').set('Cookie', s.cookie).expect(200);
    await ctx.http().post('/api/v1/auth/login').send({ email: s.email, password: 'a-new-long-password' }).expect(200);
  });
});
