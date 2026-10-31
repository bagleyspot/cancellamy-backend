import { TestCtx, activeProfile, authed, createTestApp, register } from './helpers';

const BAD_ID = 'z'.repeat(24); // 24 characters, but not hexadecimal: used to reach `new ObjectId()` and fail with a 500

describe('inputs that end up in MongoDB queries are validated at the API boundary', () => {
  let ctx: TestCtx;
  let session: Awaited<ReturnType<typeof register>>;
  let profileId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    session = await register(ctx);
    profileId = (await activeProfile(ctx, session)).id;
  });
  afterAll(() => ctx.close());

  describe('profileId must be a valid ObjectId (400, never a 500)', () => {
    it.each([
      ['GET /requests', (a: ReturnType<typeof authed>) => a.get(`/requests?profileId=${BAD_ID}`)],
      ['GET /requests/summary', (a: ReturnType<typeof authed>) => a.get(`/requests/summary?profileId=${BAD_ID}`)],
      ['GET /delistings', (a: ReturnType<typeof authed>) => a.get(`/delistings?profileId=${BAD_ID}`)],
      ['GET /nuisance', (a: ReturnType<typeof authed>) => a.get(`/nuisance?profileId=${BAD_ID}`)],
      ['POST /requests/access', (a: ReturnType<typeof authed>) => a.post('/requests/access').send({ profileId: BAD_ID, brokerIds: ['acme-leads'] })],
      ['POST /requests/custom', (a: ReturnType<typeof authed>) => a.post('/requests/custom').send({ profileId: BAD_ID, name: 'X', contactEmail: 'privacy@x.example' })],
      ['POST /delistings', (a: ReturnType<typeof authed>) => a.post('/delistings').send({ profileId: BAD_ID, engine: 'google', url: 'https://example.org/page' })],
      ['POST /nuisance', (a: ReturnType<typeof authed>) => a.post('/nuisance').send({ profileId: BAD_ID, channel: 'sms', receivedAt: '2026-10-01T10:00:00.000Z' })],
    ])('%s with a malformed profileId', async (_name, call) => {
      const res = await call(authed(ctx, session));
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/profileId/);
    });

    it('still accepts a real profileId', async () => {
      const res = await authed(ctx, session).get(`/requests?profileId=${profileId}`).expect(200);
      expect(res.body.total).toBeGreaterThan(0);
    });
  });

  describe('query operators in parameters are rejected, not passed to the database', () => {
    it.each([
      '/requests?category[$ne]=x',
      '/requests?status[$ne]=x',
      '/requests?q[$ne]=x',
      '/requests?profileId[$ne]=x',
      '/brokers?category[$ne]=x',
      '/brokers?status[$ne]=x',
      '/brokers?q[$regex]=.*',
      '/delistings?status[$ne]=x',
      '/delistings?profileId[$ne]=x',
    ])('GET %s', async (url) => {
      const res = await authed(ctx, session).get(url);
      expect(res.status).toBe(400);
    });

    it('does not let a body field carry an operator object', async () => {
      const a = authed(ctx, session);
      expect((await a.post('/requests/access').send({ profileId: { $ne: null }, brokerIds: ['acme-leads'] })).status).toBe(400);
      expect((await a.post('/delistings').send({ profileId: { $ne: null }, engine: 'google', url: 'https://example.org/p' })).status).toBe(400);
      expect((await a.post(`/profiles/${profileId}/identity/send-code`).send({ type: 'email', value: { $ne: '' } })).status).toBe(400);
      expect((await a.post(`/profiles/${profileId}/identity/confirm`).send({ type: 'email', value: { $ne: '' }, code: '123456' })).status).toBe(400);
    });

    it('does not let a path parameter carry anything but an ObjectId', async () => {
      const a = authed(ctx, session);
      expect((await a.get(`/profiles/${BAD_ID}`)).status).toBe(400);
      expect((await a.get('/requests/not-an-id')).status).toBe(400);
      expect((await a.get('/delistings/%7B%22$ne%22:null%7D')).status).toBe(400);
    });
  });
});
