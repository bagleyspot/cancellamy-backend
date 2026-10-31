import { MailError } from '../src/mail/mail.types';
import { DAY, TestCtx, activeProfile, authed, createTestApp, detail, listRequests, mailsForRef, register, requestByBroker } from './helpers';

describe('sending requests', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('sends one email per broker with delega attached, correct language and reply address; ticks are idempotent', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    const ita = await requestByBroker(ctx, s, 'infoitalia');

    const result = await ctx.scheduler.tick();
    expect(result.ran).toBe(true);
    expect(result.failed).toBe(0);

    const acmeMail = mailsForRef(ctx, acme.shortRef);
    const itaMail = mailsForRef(ctx, ita.shortRef);
    expect(acmeMail).toHaveLength(1);
    expect(itaMail).toHaveLength(1);
    const m = acmeMail[0]!;
    expect(m.to).toEqual(['privacy@acmeleads.com']);
    expect(m.subject).toContain('GDPR erasure');
    expect(m.subject).toContain(`[${acme.shortRef}]`);
    expect(m.from).toMatch(/^Cancellamy per conto di Mario Rossi <richieste@example\.org>$/);
    expect(m.replyTo).toMatch(/^r-[a-z0-9]+@in\.example\.org$/);
    expect(m.attachments?.[0]?.filename).toBe('delega.pdf');
    expect(m.attachments?.[0]?.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(m.text).toContain('mario.rossi@example.it');
    expect(m.idempotencyKey).toBe(`req-${acme.id}-erasure`);
    expect(itaMail[0]!.subject).toContain('Istanza di cancellazione');
    expect(itaMail[0]!.to).toEqual(['privacy@infoitalia.it']);

    const d = await detail(ctx, s, acme.id);
    expect(d).toMatchObject({ status: 'sent', group: 'in_progress', dryRun: true, canRemind: false, canSimulateReply: true, manual: null, canEscalate: false });
    const sentAt = new Date(d.sentAt).getTime();
    expect(new Date(d.dueAt).getTime() - sentAt).toBe(30 * DAY);
    expect(d.messages).toHaveLength(1);
    expect(d.messages[0]).toMatchObject({ direction: 'out', dryRun: true, attachments: [{ filename: 'delega.pdf', contentType: 'application/pdf' }] });
    expect(d.timeline.map((t: { type: string }) => t.type)).toEqual(['created', 'sent']);

    const before = ctx.mail.sent.length;
    await ctx.scheduler.tick();
    await ctx.scheduler.tick();
    expect(ctx.mail.sent.length).toBe(before);
  });

  it('guides manual actions with prefilled text and completes them', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    const form = await requestByBroker(ctx, s, 'form-only');
    const d = await detail(ctx, s, form.id);
    expect(d.manual).toMatchObject({ url: 'https://www.solomodulo.it/privacy/modulo' });
    expect(d.manual.steps.length).toBeGreaterThanOrEqual(3);
    expect(d.manual.prefillText).toContain('Io sottoscritto/a Mario Rossi');
    expect(d.manual.prefillText).toContain(form.shortRef);
    const api = authed(ctx, s);
    const done = await api.post(`/requests/${form.id}/mark-done`).expect(200);
    expect(done.body).toMatchObject({ status: 'sent', actionReason: null });
    expect(new Date(done.body.dueAt).getTime() - new Date(done.body.sentAt).getTime()).toBe(30 * DAY);
    expect((await api.post(`/requests/${form.id}/mark-done`).expect(409)).body.code).toBe('INVALID_STATE');

    const rpo = await requestByBroker(ctx, s, 'rpo');
    const rd = await detail(ctx, s, rpo.id);
    expect(rd.manual.phone).toBe('800 957 766');
    expect(rd.manual.steps[0]).toContain('Registro Pubblico delle Opposizioni');
    const rdone = await api.post(`/requests/${rpo.id}/mark-done`).expect(200);
    expect(rdone.body).toMatchObject({ status: 'completed', nextCheckAt: null });

    const acme = await requestByBroker(ctx, s, 'acme-leads');
    await api.post(`/requests/${acme.id}/mark-done`).expect(409);
  });

  it('summarises, lists and filters requests', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    const api = authed(ctx, s);
    const rpo = await requestByBroker(ctx, s, 'rpo');
    await api.post(`/requests/${rpo.id}/mark-done`).expect(200);

    const sum = (await api.get('/requests/summary').expect(200)).body;
    expect(sum.counts).toEqual({ total: 4, toSend: 0, inProgress: 2, actionRequired: 1, completed: 1, notRemovable: 0 });
    expect(sum.coverage).toEqual({ brokersTracked: 7, brokersCovered: 4, brokersNotYetCovered: 3 });
    expect(sum.completionRate).toBeCloseTo(0.25, 2);
    expect(sum.completedByMonth).toHaveLength(12);
    expect(sum.completedByMonth[11].count).toBe(1);
    expect(sum.recentActivity.length).toBeGreaterThan(0);
    expect(sum.byCategory.find((c: { category: string }) => c.category === 'opposition_register')).toMatchObject({ total: 1, completed: 1 });

    expect((await listRequests(ctx, s, 'group=in_progress')).total).toBe(2);
    expect((await listRequests(ctx, s, 'group=action_required')).total).toBe(1);
    expect((await listRequests(ctx, s, 'group=completed')).total).toBe(1);
    expect((await listRequests(ctx, s, 'status=sent')).total).toBe(2);
    expect((await listRequests(ctx, s, 'category=business_info')).items.map((r) => r.broker.id)).toEqual(['infoitalia']);
    expect((await listRequests(ctx, s, 'q=acme')).total).toBe(1);
    const page = (await api.get('/requests?limit=3&page=2').expect(200)).body;
    expect(page).toMatchObject({ total: 4, page: 2, limit: 3 });
    expect(page.items).toHaveLength(1);
    await api.get('/requests?group=nonsense').expect(400);
    await api.get('/requests?limit=1000').expect(400);
    const sumProfile = (await api.get(`/requests/summary?profileId=${rpo.profileId}`).expect(200)).body;
    expect(sumProfile.counts.total).toBe(4);
  });

  it("never exposes another user's requests", async () => {
    const a = await register(ctx);
    const b = await register(ctx);
    await activeProfile(ctx, a);
    const r = (await listRequests(ctx, a)).items[0]!;
    await authed(ctx, b).get(`/requests/${r.id}`).expect(404);
    await authed(ctx, b).post(`/requests/${r.id}/cancel`).expect(404);
    await authed(ctx, b).post(`/requests/${r.id}/simulate-reply`).send({ kind: 'completed' }).expect(404);
    expect((await listRequests(ctx, b)).total).toBe(0);
    await authed(ctx, b).get('/requests/xyz').expect(400);
  });

  it('retries transient failures with backoff and hands over to the user after 5 attempts', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    ctx.mail.failWith = new MailError('provider down', true);
    try {
      let result = await ctx.scheduler.tick();
      expect(result.retried).toBeGreaterThanOrEqual(1);
      let d = await detail(ctx, s, acme.id);
      expect(d.status).toBe('queued');
      // Not due yet: nothing is claimed.
      result = await ctx.scheduler.tick();
      expect(result.retried).toBe(0);
      for (let i = 0; i < 6; i++) {
        ctx.clock.advance(20 * 60 * 1000);
        await ctx.scheduler.tick();
      }
      d = await detail(ctx, s, acme.id);
      expect(d).toMatchObject({ status: 'action_required', channel: 'manual', actionReason: 'manual_steps' });
      expect(d.manual.prefillText).toContain('Mario Rossi');
      expect(d.timeline.some((t: { note?: string }) => t.note?.includes('Invio automatico non riuscito'))).toBe(true);
      const notes = (await authed(ctx, s).get('/notifications').expect(200)).body.items;
      expect(notes.some((n: { title: string }) => n.title.includes('Azione richiesta'))).toBe(true);
    } finally {
      ctx.mail.failWith = undefined;
    }
  });

  it('turns a permanent provider error into a manual action immediately', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    const ita = await requestByBroker(ctx, s, 'infoitalia');
    ctx.mail.failWith = new MailError('invalid recipient', false);
    try {
      const result = await ctx.scheduler.tick();
      expect(result.failed).toBeGreaterThanOrEqual(1);
      expect((await detail(ctx, s, ita.id)).status).toBe('action_required');
    } finally {
      ctx.mail.failWith = undefined;
    }
  });

  it('does not send while the profile is paused, then sends after resume', async () => {
    const s = await register(ctx);
    const { id } = await activeProfile(ctx, s);
    const api = authed(ctx, s);
    await api.post(`/profiles/${id}/pause`).expect(200);
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    await ctx.scheduler.tick();
    expect(mailsForRef(ctx, acme.shortRef)).toHaveLength(0);
    expect((await detail(ctx, s, acme.id)).status).toBe('queued');
    await api.post(`/profiles/${id}/resume`).expect(200);
    ctx.clock.advance(11 * 60 * 1000);
    await ctx.scheduler.tick();
    expect(mailsForRef(ctx, acme.shortRef)).toHaveLength(1);
  });

  it('cancels a queued request before it is sent', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    const api = authed(ctx, s);
    expect((await api.post(`/requests/${acme.id}/cancel`).expect(200)).body).toMatchObject({ status: 'cancelled', group: 'not_removable' });
    await ctx.scheduler.tick();
    expect(mailsForRef(ctx, acme.shortRef)).toHaveLength(0);
    // Cancelling twice is idempotent; a finished request cannot be cancelled.
    expect((await api.post(`/requests/${acme.id}/cancel`).expect(200)).body.status).toBe('cancelled');
    const rpo = await requestByBroker(ctx, s, 'rpo');
    await api.post(`/requests/${rpo.id}/mark-done`).expect(200);
    expect((await api.post(`/requests/${rpo.id}/cancel`).expect(409)).body.code).toBe('INVALID_STATE');
  });
});
