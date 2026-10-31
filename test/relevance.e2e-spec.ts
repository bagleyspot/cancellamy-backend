import { join } from 'path';
import { Types } from 'mongoose';
import { DAY, TestCtx, activeProfile, authed, createTestApp, listRequests, register } from './helpers';

const US_ADDRESS = { street: '1 Main St', city: 'Austin', zip: '73301', province: 'TX', country: 'US' };

/** When each broker's first request is due, in days after activation (0 = right away). */
async function dueDays(ctx: TestCtx, profileId: string): Promise<Record<string, number>> {
  const docs = await ctx.connection.collection('removalrequests').find({ profileId: new Types.ObjectId(profileId) }).toArray();
  const first = Math.min(...docs.map((d) => (d.nextAttemptAt as Date).getTime()));
  return Object.fromEntries(docs.map((d) => [d.brokerKey as string, Math.round(((d.nextAttemptAt as Date).getTime() - first) / DAY)]));
}

async function withMode(mode: string | undefined, run: (ctx: TestCtx) => Promise<void>) {
  const saved = { REGISTRY_PATH: process.env.REGISTRY_PATH, USER_DAILY_REQUEST_LIMIT: process.env.USER_DAILY_REQUEST_LIMIT, BROKER_RELEVANCE: process.env.BROKER_RELEVANCE };
  process.env.REGISTRY_PATH = join(__dirname, 'fixtures', 'brokers.relevance.yaml');
  process.env.USER_DAILY_REQUEST_LIMIT = '1'; // one email a day: the order shows in the due dates
  if (mode) process.env.BROKER_RELEVANCE = mode;
  else delete process.env.BROKER_RELEVANCE;
  const ctx = await createTestApp();
  try {
    await run(ctx);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await ctx.close();
  }
}

describe('matching brokers with a profile', () => {
  it('prioritize (default): relevant brokers first, official-site verified first, other markets last, unknown markets never', async () => {
    await withMode(undefined, async (ctx) => {
      const s = await register(ctx);
      const { id } = await activeProfile(ctx, s);

      const brokers = (await listRequests(ctx, s)).items.map((r) => r.broker.id).sort();
      expect(brokers).toEqual(['de-only', 'global-adtech', 'it-auto', 'it-official', 'us-hq']); // no "unclassified"
      const days = await dueDays(ctx, id);
      await ctx.scheduler.tick(); // syncNewBrokers must not add what activation left out
      expect((await listRequests(ctx, s)).items.map((r) => r.broker.id).sort()).toEqual(brokers);
      expect(days['it-official']).toBe(0); // read on the official site: first
      expect(days['global-adtech']).toBe(1); // then the other relevant ones, by name
      expect(days['it-auto']).toBe(2);
      expect(Math.min(days['de-only']!, days['us-hq']!)).toBe(3); // other markets after every relevant broker
      expect(Math.max(days['de-only']!, days['us-hq']!)).toBe(4);
    });
  });

  it('uses the countries of the profile: a profile in the US gets the US broker before the Italian ones', async () => {
    await withMode(undefined, async (ctx) => {
      const s = await register(ctx);
      const { id } = await activeProfile(ctx, s, { addresses: [US_ADDRESS] });

      const days = await dueDays(ctx, id);
      expect(days['us-hq']).toBe(0); // relevant to a profile in the US, by name
      expect(days['global-adtech']).toBe(1);
      expect(Math.min(days['it-official']!, days['it-auto']!, days['de-only']!)).toBe(2);
      expect((await listRequests(ctx, s)).items.map((r) => r.broker.id)).not.toContain('unclassified');
    });
  });

  it('strict: only brokers relevant to the profile', async () => {
    await withMode('strict', async (ctx) => {
      const s = await register(ctx);
      await activeProfile(ctx, s);
      expect((await listRequests(ctx, s)).items.map((r) => r.broker.id).sort()).toEqual(['global-adtech', 'it-auto', 'it-official']);
      await ctx.scheduler.tick();
      expect((await listRequests(ctx, s)).items).toHaveLength(3);
    });
  });

  it('off: every sendable broker, including the unclassified one (the behaviour before relevance)', async () => {
    await withMode('off', async (ctx) => {
      const s = await register(ctx);
      await activeProfile(ctx, s);
      expect((await listRequests(ctx, s)).items.map((r) => r.broker.id).sort()).toEqual([
        'de-only', 'global-adtech', 'it-auto', 'it-official', 'unclassified', 'us-hq',
      ]);
    });
  });

  it('stores the markets and the official-site flag on the broker', async () => {
    await withMode(undefined, async (ctx) => {
      const s = await register(ctx);
      await authed(ctx, s).get('/brokers').expect(200);
      const read = async () => Object.fromEntries((await ctx.connection.collection('brokers').find().toArray()).map((b) => [b.slug, [b.markets, b.officialSiteVerified]]));
      const before = await read();
      expect(before['it-official']).toEqual([['IT'], true]);
      expect(before['it-auto']).toEqual([['IT'], false]);
      expect(before['global-adtech']).toEqual([['ALL'], false]);
      expect(before['unclassified']).toEqual([[], false]);
    });
  });
});
