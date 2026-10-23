import { DAY, TestCtx, authed, createTestApp, profileInput, register, Session } from './helpers';

const EMAIL = 'mario.rossi@example.it';
const OTHER = 'mario.secondo@example.it';

describe('breach check disabled (no API key)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('reports itself as disabled and refuses to run', async () => {
    expect((await ctx.http().get('/api/v1/config').expect(200)).body.features.breachCheck).toBe(false);
    const s = await register(ctx);
    const { body } = await authed(ctx, s).post('/profiles').send(profileInput()).expect(201);
    const summary = (await authed(ctx, s).get(`/profiles/${body.id}/breaches`).expect(200)).body;
    expect(summary).toMatchObject({ enabled: false, emails: [], unverifiedEmails: [] });
    expect(summary.attribution).toContain('Have I Been Pwned');
    expect((await authed(ctx, s).post(`/profiles/${body.id}/breaches/check`).expect(404)).body.code).toBe('FEATURE_DISABLED');
  });
});

describe('breach check (Have I Been Pwned)', () => {
  let ctx: TestCtx;
  let fetchMock: jest.SpyInstance;
  let answers: Record<string, { status: number; body?: unknown; headers?: Record<string, string> }>;
  const calls: { url: string; headers: Record<string, string> }[] = [];

  const breach = (name: string) => ({ Name: name, Title: `${name} breach`, Domain: `${name.toLowerCase()}.com`, BreachDate: '2013-10-04', AddedDate: '2013-12-04T00:00:00Z', DataClasses: ['Email addresses', 'Passwords'], IsVerified: true, IsSensitive: false });

  beforeAll(async () => {
    process.env.HAVEIBEENPWNED_API_KEY = 'hibp_test_key';
    ctx = await createTestApp();
  });
  afterAll(async () => {
    delete process.env.HAVEIBEENPWNED_API_KEY;
    await ctx.close();
  });
  beforeEach(() => {
    answers = {};
    calls.length = 0;
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('https://haveibeenpwned.com/api/v3/breachedaccount/')) throw new Error(`unexpected fetch ${url}`);
      calls.push({ url, headers: init?.headers as Record<string, string> });
      const email = decodeURIComponent(url.replace('https://haveibeenpwned.com/api/v3/breachedaccount/', '').split('?')[0] as string);
      const a = answers[email] ?? { status: 404 };
      return new Response(a.body ? JSON.stringify(a.body) : null, { status: a.status, headers: a.headers });
    });
  });
  afterEach(() => fetchMock.mockRestore());

  async function profile(): Promise<{ s: Session; id: string }> {
    const s = await register(ctx);
    const { body } = await authed(ctx, s).post('/profiles').send(profileInput({ emails: [EMAIL, OTHER], phones: [] })).expect(201);
    const api = authed(ctx, s);
    await api.post(`/profiles/${body.id}/identity/send-code`).send({ type: 'email', value: EMAIL }).expect(204);
    const mails = ctx.mail.to(EMAIL).filter((m) => /codice di verifica/i.test(m.subject));
    const code = /(\d{6})/.exec(mails[mails.length - 1]?.subject ?? '')?.[1] as string;
    await api.post(`/profiles/${body.id}/identity/confirm`).send({ type: 'email', value: EMAIL, code }).expect(200);
    return { s, id: body.id as string };
  }

  it('checks only verified emails, sends the API key, notifies and rechecks monthly', async () => {
    expect((await ctx.http().get('/api/v1/config').expect(200)).body.features.breachCheck).toBe(true);
    const { s, id } = await profile();
    const api = authed(ctx, s);
    const first = (await api.get(`/profiles/${id}/breaches`).expect(200)).body;
    expect(first).toMatchObject({ enabled: true, unverifiedEmails: [OTHER] });
    expect(first.emails).toEqual([{ email: EMAIL, status: 'pending', lastCheckedAt: null, breaches: [] }]);

    answers[EMAIL] = { status: 200, body: [breach('Adobe'), breach('LinkedIn')] };
    expect((await ctx.scheduler.tick()).breaches).toBeGreaterThanOrEqual(1);
    expect(calls.every((c) => c.url.includes(encodeURIComponent(EMAIL)))).toBe(true); // the unverified email is never queried
    expect(calls[0]!.headers['hibp-api-key']).toBe('hibp_test_key');
    expect(calls[0]!.headers['user-agent']).toBe('Cancellamy');
    expect(calls[0]!.url).toContain('truncateResponse=false');

    const done = (await api.get(`/profiles/${id}/breaches`).expect(200)).body;
    expect(done.emails[0]).toMatchObject({ email: EMAIL, status: 'checked' });
    expect(done.emails[0].breaches.map((b: { name: string }) => b.name)).toEqual(['Adobe', 'LinkedIn']);
    expect(done.emails[0].breaches[0]).toMatchObject({ title: 'Adobe breach', dataClasses: ['Email addresses', 'Passwords'], isVerified: true, domain: 'adobe.com' });
    const notes = (await api.get('/notifications').expect(200)).body.items;
    expect(notes.find((n: { title: string }) => n.title.includes('compare in 2 violazioni')).body).toContain('Have I Been Pwned');

    const callsBefore = calls.length;
    await ctx.scheduler.tick();
    expect(calls.length).toBe(callsBefore); // not due yet

    answers[EMAIL] = { status: 200, body: [breach('Adobe'), breach('LinkedIn'), breach('Canva')] };
    ctx.clock.advance(31 * DAY);
    await ctx.scheduler.tick();
    expect((await api.get(`/profiles/${id}/breaches`).expect(200)).body.emails[0].breaches).toHaveLength(3);
    const after = (await api.get('/notifications').expect(200)).body.items;
    expect(after.filter((n: { title: string }) => n.title.includes('Nuova violazione di dati')).map((n: { title: string }) => n.title)).toEqual(['Nuova violazione di dati: Canva breach']);
  });

  it('treats 404 as "no breaches" and does not notify', async () => {
    const { s, id } = await profile();
    await ctx.scheduler.tick();
    const api = authed(ctx, s);
    expect((await api.get(`/profiles/${id}/breaches`).expect(200)).body.emails[0]).toMatchObject({ status: 'checked', breaches: [] });
    expect((await api.get('/notifications').expect(200)).body.items.some((n: { title: string }) => n.title.includes('violazion'))).toBe(false);
  });

  it('limits manual checks to one per hour and rechecks on demand', async () => {
    const { s, id } = await profile();
    const api = authed(ctx, s);
    await ctx.scheduler.tick();
    const n = calls.length;
    expect((await api.post(`/profiles/${id}/breaches/check`).expect(202)).body).toEqual({ queued: 1 });
    expect((await api.post(`/profiles/${id}/breaches/check`).expect(429)).body.code).toBe('RATE_LIMITED');
    await ctx.scheduler.tick();
    expect(calls.length).toBeGreaterThan(n);
    ctx.clock.advance(61 * 60_000);
    await api.post(`/profiles/${id}/breaches/check`).expect(202);
    await authed(ctx, await register(ctx)).post(`/profiles/${id}/breaches/check`).expect(404);
  });

  it('backs off when the API rate-limits or the key is rejected', async () => {
    const { s, id } = await profile();
    const api = authed(ctx, s);
    answers[EMAIL] = { status: 429, headers: { 'retry-after': '120' } };
    await ctx.scheduler.tick();
    let n = calls.length;
    expect((await api.get(`/profiles/${id}/breaches`).expect(200)).body.emails[0].status).toBe('pending');
    await ctx.scheduler.tick();
    expect(calls.length).toBe(n); // waits for Retry-After
    ctx.clock.advance(121_000);
    answers[EMAIL] = { status: 401 };
    await ctx.scheduler.tick();
    n = calls.length;
    expect((await api.get(`/profiles/${id}/breaches`).expect(200)).body.emails[0].status).toBe('error');
    await ctx.scheduler.tick();
    expect(calls.length).toBe(n); // retried only after an hour
    ctx.clock.advance(61 * 60_000);
    answers[EMAIL] = { status: 200, body: [breach('Dropbox')] };
    await ctx.scheduler.tick();
    expect((await api.get(`/profiles/${id}/breaches`).expect(200)).body.emails[0]).toMatchObject({ status: 'checked' });
  });

  it('stores the checked email encrypted', async () => {
    const { s } = await profile();
    await ctx.scheduler.tick();
    expect(s.email).toBeTruthy();
    expect(JSON.stringify(await ctx.connection.collection('breachchecks').find({}).toArray())).not.toContain(EMAIL);
  });
});
