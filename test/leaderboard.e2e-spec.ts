import { LeaderboardService } from '../src/leaderboard/leaderboard.service';
import { DAY, TestCtx, activeProfile, authed, createTestApp, register, requestByBroker, Session } from './helpers';

describe('public broker leaderboard', () => {
  let ctx: TestCtx;
  const board = (query = '') => {
    ctx.app.get(LeaderboardService).invalidate();
    return ctx.http().get(`/api/v1/brokers/leaderboard${query}`);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    ctx.mail.real = true; // pretend emails are really delivered: simulations never count
  });
  afterAll(() => ctx.close());

  async function user(): Promise<Session> {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    return s;
  }
  const reply = async (s: Session, brokerId: string, kind: 'completed' | 'refused') => {
    const r = await requestByBroker(ctx, s, brokerId);
    await authed(ctx, s).post(`/requests/${r.id}/simulate-reply`).send({ kind }).expect(200);
  };

  it('hides brokers below the privacy threshold and exposes only aggregates', async () => {
    const a = await user();
    const b = await user();
    await ctx.scheduler.tick();
    ctx.clock.advance(31 * DAY);
    await ctx.scheduler.tick();
    await reply(a, 'acme-leads', 'completed');
    const res = (await board().expect(200)).body;
    expect(res).toMatchObject({ minUsers: 3, items: [] });
    expect(res.hiddenBrokers).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(res)).not.toContain(a.userId);
    expect(b.userId).toBeTruthy();
  });

  it('computes response, completion, refusal and overdue rates once enough users contributed', async () => {
    const users = [await user(), await user()];
    await ctx.scheduler.tick();
    ctx.clock.advance(31 * DAY);
    await ctx.scheduler.tick(); // everything is now past its 30-day deadline
    // 4 users overall (2 from the previous test): acme answered by 3 of them, infoitalia refused by 2.
    const all = (await ctx.connection.collection('users').find({ email: { $not: /^admin/ } }).toArray()).map((u) => String(u._id));
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const u of users) await reply(u, 'acme-leads', 'completed');
    const first = (await ctx.connection.collection('removalrequests').find({ brokerKey: 'acme-leads', kind: 'erasure', status: 'overdue' }).toArray())[0];
    expect(first).toBeTruthy(); // the very first user never got an answer
    for (const u of users) await reply(u, 'infoitalia', 'refused');

    const res = (await board().expect(200)).body;
    const acme = res.items.find((i: { broker: { id: string } }) => i.broker.id === 'acme-leads');
    expect(acme).toBeDefined();
    expect(acme.users).toBe(4);
    expect(acme.responseRate).toBeCloseTo(0.75, 2); // 3 of the 4 users got an answer
    expect(acme.completionRate).toBeCloseTo(0.75, 2);
    expect(acme.refusalRate).toBe(0);
    expect(acme.overdueRate).toBeCloseTo(0.25, 2); // one user is still waiting after the deadline
    expect(acme.medianDaysToFirstReply).toBeGreaterThanOrEqual(30);
    expect(acme.broker).toMatchObject({ name: 'Acme Leads Inc.', category: 'b2b_enrichment' });
    const ita = res.items.find((i: { broker: { id: string } }) => i.broker.id === 'infoitalia');
    expect(ita.refusalRate).toBeCloseTo(0.5, 2);
    expect(ita.completionRate).toBe(0);
    // Manual brokers have no sent requests: they stay hidden.
    expect(res.items.some((i: { broker: { id: string } }) => i.broker.id === 'form-only')).toBe(false);
    expect(res.hiddenBrokers).toBeGreaterThanOrEqual(2);
  });

  it('ignores dry-run simulations', async () => {
    ctx.mail.real = false;
    const before = (await board().expect(200)).body.items.find((i: { broker: { id: string } }) => i.broker.id === 'acme-leads');
    for (let i = 0; i < 3; i++) {
      const s = await user();
      await ctx.scheduler.tick();
      await reply(s, 'acme-leads', 'completed');
    }
    ctx.mail.real = true;
    const after = (await board().expect(200)).body.items.find((i: { broker: { id: string } }) => i.broker.id === 'acme-leads');
    expect(after.users).toBe(before.users);
    expect(after.requests).toBe(before.requests);
  });

  it('sorts, filters by category, validates the query and caches the result', async () => {
    const byUsers = (await board('?sort=users&order=desc').expect(200)).body.items;
    expect(byUsers.map((i: { users: number }) => i.users)).toEqual([...byUsers.map((i: { users: number }) => i.users)].sort((x, y) => y - x));
    const byRefusal = (await board('?sort=refusalRate&order=desc').expect(200)).body.items;
    expect(byRefusal[0].broker.id).toBe('infoitalia');
    const asc = (await board('?sort=refusalRate&order=asc').expect(200)).body.items;
    expect(asc[asc.length - 1].broker.id).toBe('infoitalia');
    const cat = (await board('?category=business_info').expect(200)).body.items;
    expect(cat.map((i: { broker: { id: string } }) => i.broker.id)).toEqual(['infoitalia']);
    await ctx.http().get('/api/v1/brokers/leaderboard?sort=hacks').expect(400);
    await ctx.http().get('/api/v1/brokers/leaderboard?category=bogus').expect(400);
    const one = await ctx.http().get('/api/v1/brokers/leaderboard').expect(200);
    const two = await ctx.http().get('/api/v1/brokers/leaderboard').expect(200);
    expect(two.body.generatedAt).toBe(one.body.generatedAt); // served from the cache
    await ctx.http().get('/api/v1/brokers/acme-leads').expect(200); // the route did not shadow the broker detail
  });

  it('can be switched off by the operator', async () => {
    process.env.FEATURES_DISABLED = 'leaderboard';
    const off = await createTestApp();
    try {
      expect((await off.http().get('/api/v1/brokers/leaderboard').expect(404)).body.code).toBe('FEATURE_DISABLED');
      expect((await off.http().get('/api/v1/config').expect(200)).body.features.leaderboard).toBe(false);
    } finally {
      delete process.env.FEATURES_DISABLED;
      await off.close();
    }
  });
});
