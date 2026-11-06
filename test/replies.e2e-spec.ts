import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RemovalRequest, RequestDoc } from '../src/db/schemas';
import { RequestEngine } from '../src/requests/request-engine';
import { TestCtx, activeProfile, authed, createTestApp, detail, listRequests, register, requestByBroker } from './helpers';

describe('recording how brokers answered', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  async function record(id: string, input: Parameters<RequestEngine['recordReply']>[1]) {
    const requests = ctx.app.get<Model<RequestDoc>>(getModelToken(RemovalRequest.name));
    const req = await requests.findById(id);
    if (!req) throw new Error('request not found');
    return ctx.app.get(RequestEngine).recordReply(req, input);
  }

  it('moves the requests like real replies and shows the answer in the list and the detail', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    const ita = await requestByBroker(ctx, s, 'infoitalia');
    const at = new Date('2026-11-05T22:30:00.000Z');

    await record(acme.id, { outcome: 'no_data_held', at, from: 'privacy@acmeleads.com', note: 'Says it holds no data about the requester.' });
    await record(ita.id, { outcome: 'needs_portal', at, note: 'Use the portal.', manual: { url: 'https://portal.example/dsr', steps: ['Open the portal', 'Verify the email'] } });

    const done = await detail(ctx, s, acme.id);
    expect(done).toMatchObject({ status: 'completed', group: 'completed', reply: { outcome: 'no_data_held', date: at.toISOString(), note: 'Says it holds no data about the requester.' } });
    expect(done.completedAt).not.toBeNull();
    expect(done.nextCheckAt).not.toBeNull(); // the periodic re-check still happens
    expect(done.messages.filter((m: { direction: string }) => m.direction === 'in')).toHaveLength(1);
    expect(done.timeline.map((t: { type: string }) => t.type)).toContain('reply_received');

    const action = await detail(ctx, s, ita.id);
    expect(action).toMatchObject({ status: 'action_required', actionReason: 'manual_form', reply: { outcome: 'needs_portal' } });
    expect(action.manual).toMatchObject({ url: 'https://portal.example/dsr', steps: ['Open the portal', 'Verify the email'], email: 'privacy@infoitalia.it' }); // the stored recipient is kept

    const list = await listRequests(ctx, s);
    expect(list.items.find((r) => r.id === acme.id)?.reply).toMatchObject({ outcome: 'no_data_held' });
    expect((await listRequests(ctx, s, 'group=completed')).items.map((r) => r.id)).toContain(acme.id);
    expect((await listRequests(ctx, s, 'group=action_required')).items.map((r) => r.id)).toContain(ita.id);
  });

  it('keeps a request without an answer at reply null, and a receipt only moves it to replied', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    expect((await detail(ctx, s, acme.id)).reply).toBeNull();

    const plan = await record(acme.id, { outcome: 'acknowledged', at: new Date('2026-11-05T22:30:00.000Z'), note: 'Ticket opened.' });

    expect(plan.to).toBe('replied');
    expect(await detail(ctx, s, acme.id)).toMatchObject({ status: 'replied', group: 'in_progress', reply: { outcome: 'acknowledged' } });
    await authed(ctx, s).get('/requests?status=replied').expect(200);
  });

  it('does not reopen a completed request when a later answer is recorded', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    await record(acme.id, { outcome: 'no_data_held', at: new Date('2026-11-05T22:30:00.000Z') });
    await record(acme.id, { outcome: 'needs_portal', at: new Date('2026-11-06T08:00:00.000Z'), note: 'Later message.' });

    expect(await detail(ctx, s, acme.id)).toMatchObject({ status: 'completed', reply: { outcome: 'needs_portal' } });
  });
});
