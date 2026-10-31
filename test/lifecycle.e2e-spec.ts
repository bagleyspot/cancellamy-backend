import { DAY, TestCtx, activeProfile, authed, createTestApp, detail, listRequests, mailsForRef, register, requestByBroker, profileInput } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

describe('broker replies (dry-run simulation)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('handles an identity-document request end to end without storing the document', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    const api = authed(ctx, s);
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    const d1 = (await api.post(`/requests/${acme.id}/simulate-reply`).send({ kind: 'id_required' }).expect(200)).body;
    expect(d1).toMatchObject({ status: 'action_required', actionReason: 'id_required', canProvideId: true, group: 'action_required' });
    expect(d1.messages.map((m: { direction: string }) => m.direction)).toEqual(['out', 'in']);
    expect(d1.messages[1]).toMatchObject({ classification: 'id_required' });

    const notes = (await api.get('/notifications').expect(200)).body.items;
    expect(notes.find((n: { type: string }) => n.type === 'action_required')).toMatchObject({ requestId: acme.id });
    expect(ctx.mail.to(s.email).some((m) => m.subject.includes('chiede un documento'))).toBe(true);

    await api.post(`/requests/${acme.id}/provide-id`).expect(400);
    await api.post(`/requests/${acme.id}/provide-id`).attach('file', Buffer.from('x'), { filename: 'a.exe', contentType: 'application/x-msdownload' }).expect(400);
    await api.post(`/requests/${acme.id}/provide-id`).attach('file', Buffer.alloc(6 * 1024 * 1024), { filename: 'big.pdf', contentType: 'application/pdf' }).expect(413);

    const before = ctx.mail.sent.length;
    const d2 = (await api.post(`/requests/${acme.id}/provide-id`).field('note', 'ecco il documento').attach('file', PDF, { filename: 'carta identità.pdf', contentType: 'application/pdf' }).expect(200)).body;
    expect(d2).toMatchObject({ status: 'sent', actionReason: null, canProvideId: false });
    expect(new Date(d2.dueAt).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    const mail = ctx.mail.sent[ctx.mail.sent.length - 1]!;
    expect(ctx.mail.sent.length).toBe(before + 1);
    expect(mail.to).toEqual(['privacy@acmeleads.com']);
    expect(mail.attachments?.[0]?.content.equals(PDF)).toBe(true);
    expect(mail.attachments?.[0]?.filename).toBe('carta identit_.pdf');
    expect(mail.text).toContain('ecco il documento');
    const outMsg = d2.messages[d2.messages.length - 1];
    expect(outMsg.attachments[0].filename).toContain('non conservato');
    const stored = JSON.stringify(await ctx.connection.collection('messages').find({}).toArray());
    expect(stored).not.toContain('%PDF-1.4');
    await api.post(`/requests/${acme.id}/provide-id`).attach('file', PDF, { filename: 'again.pdf', contentType: 'application/pdf' }).expect(409);
  });

  it('records a refusal and a completion with the right statuses', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    const api = authed(ctx, s);
    const ita = await requestByBroker(ctx, s, 'infoitalia');
    const refused = (await api.post(`/requests/${ita.id}/simulate-reply`).send({ kind: 'refused' }).expect(200)).body;
    expect(refused).toMatchObject({ status: 'refused', group: 'not_removable' });
    expect(refused.messages[1]).toMatchObject({ direction: 'in', classification: 'refused' });
    expect(refused.messages[1].text).toContain('obbligo di legge');
    expect((await api.post(`/requests/${ita.id}/outcome`).send({ outcome: 'completed' }).expect(409)).body.code).toBe('INVALID_STATE');
    await api.post(`/requests/${ita.id}/simulate-reply`).send({ kind: 'completed' }).expect(409);

    const acme = await requestByBroker(ctx, s, 'acme-leads');
    const done = (await api.post(`/requests/${acme.id}/simulate-reply`).send({ kind: 'completed' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'completed', group: 'completed' });
    const next = new Date(done.nextCheckAt).getTime();
    expect(next - new Date(done.completedAt).getTime()).toBe(90 * DAY);
    await api.post(`/requests/${acme.id}/simulate-reply`).send({ kind: 'refused' }).expect(409);
    await api.post(`/requests/${acme.id}/simulate-reply`).send({ kind: 'bogus' }).expect(400);
  });

  it('keeps unclear replies for the user, who decides the outcome', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    const api = authed(ctx, s);
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    const replied = (await api.post(`/requests/${acme.id}/simulate-reply`).send({ kind: 'unknown' }).expect(200)).body;
    expect(replied).toMatchObject({ status: 'replied', group: 'in_progress' });
    expect(replied.messages[1].classification).toBe('unknown');
    expect((await api.post(`/requests/${acme.id}/outcome`).send({ outcome: 'in_progress' }).expect(200)).body.status).toBe('sent');
    await api.post(`/requests/${acme.id}/simulate-reply`).send({ kind: 'unknown' }).expect(200);
    const out = (await api.post(`/requests/${acme.id}/outcome`).send({ outcome: 'completed', note: 'confermato al telefono' }).expect(200)).body;
    expect(out.status).toBe('completed');
    expect(out.timeline.some((t: { note?: string }) => t.note === 'confermato al telefono')).toBe(true);
    await api.post(`/requests/${acme.id}/outcome`).send({ outcome: 'bogus' }).expect(400);
  });

  it('cannot simulate on manual requests', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    const form = await requestByBroker(ctx, s, 'form-only');
    await authed(ctx, s).post(`/requests/${form.id}/simulate-reply`).send({ kind: 'completed' }).expect(409);
  });
});

describe('notifications and reports', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('creates in-app notifications, supports unread filter and mark-as-read', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    const api = authed(ctx, s);
    const base = (await api.get('/notifications/unread-count').expect(200)).body.count as number; // e.g. the monthly report
    const r = await requestByBroker(ctx, s, 'acme-leads');
    await api.post(`/requests/${r.id}/simulate-reply`).send({ kind: 'completed' }).expect(200);
    const ita = await requestByBroker(ctx, s, 'infoitalia');
    await api.post(`/requests/${ita.id}/simulate-reply`).send({ kind: 'refused' }).expect(200);
    expect((await api.get('/notifications/unread-count').expect(200)).body.count).toBe(base + 2);
    const list = (await api.get('/notifications?limit=1&page=1').expect(200)).body;
    expect(list).toMatchObject({ total: base + 2, page: 1, limit: 1 });
    const first = list.items[0];
    await api.post('/notifications/read').send({ ids: [first.id] }).expect(204);
    expect((await api.get('/notifications/unread-count').expect(200)).body.count).toBe(base + 1);
    expect((await api.get('/notifications?unread=true').expect(200)).body.total).toBe(base + 1);
    await api.post('/notifications/read').send({}).expect(204);
    expect((await api.get('/notifications/unread-count').expect(200)).body.count).toBe(0);
    await authed(ctx, await register(ctx)).get('/notifications').expect(200).expect((res) => expect(res.body.total).toBe(0));
  });

  it('respects the email notification setting but still records in-app notifications', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    await api.patch('/me').send({ settings: { notifyByEmail: false } }).expect(200);
    await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    const r = await requestByBroker(ctx, s, 'acme-leads');
    const before = ctx.mail.to(s.email).length;
    const baseTotal = (await api.get('/notifications').expect(200)).body.total as number;
    await api.post(`/requests/${r.id}/simulate-reply`).send({ kind: 'completed' }).expect(200);
    expect(ctx.mail.to(s.email).length).toBe(before);
    expect((await api.get('/notifications').expect(200)).body.total).toBe(baseTotal + 1);
  });

  it('generates a monthly report on demand (idempotent per period)', async () => {
    const s = await register(ctx);
    const { id } = await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    const api = authed(ctx, s);
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    await api.post(`/requests/${acme.id}/simulate-reply`).send({ kind: 'completed' }).expect(200);
    const rep = (await api.post('/reports/generate').send({ profileId: id }).expect(201)).body;
    expect(rep.period).toMatch(/^\d{4}-\d{2}$/);
    expect(rep.stats).toMatchObject({ sent: 2, completed: 1, actionRequired: 2 });
    expect(rep.highlights.join(' ')).toContain('Acme Leads');
    const again = (await api.post('/reports/generate').send({ profileId: id }).expect(201)).body;
    expect(again.id).toBe(rep.id);
    const list = (await api.get(`/reports?profileId=${id}`).expect(200)).body;
    expect(list.some((r: { id: string }) => r.id === rep.id)).toBe(true);
    await authed(ctx, await register(ctx)).post('/reports/generate').send({ profileId: id }).expect(404);
  });
});

describe('custom removals', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('sends a custom request by email, guides a manual one, and enforces the monthly limit', async () => {
    const s = await register(ctx);
    const { id } = await activeProfile(ctx, s);
    const api = authed(ctx, s);
    await api.post('/requests/custom').send({ profileId: id, name: 'X', website: 'not-a-url' }).expect(400);
    await api.post('/requests/custom').send({ profileId: id, name: 'X', contactEmail: 'nope' }).expect(400);
    const email = (await api.post('/requests/custom').send({ profileId: id, name: 'Sito Esempio', website: 'https://esempio.it', contactEmail: 'Privacy@Esempio.it' }).expect(201)).body;
    expect(email).toMatchObject({ custom: true, channel: 'email', status: 'queued' });
    await ctx.scheduler.tick();
    const mails = mailsForRef(ctx, email.shortRef);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toEqual(['privacy@esempio.it']);
    expect(mails[0]!.subject).toContain('Istanza di cancellazione');
    const d = await detail(ctx, s, email.id);
    expect(d).toMatchObject({ status: 'sent', custom: true });
    expect(d.broker).toMatchObject({ category: 'other', channelTypes: ['email'] });

    const manual = (await api.post('/requests/custom').send({ profileId: id, name: 'Altro Sito', website: 'https://altro.example.com' }).expect(201)).body;
    expect(manual).toMatchObject({ channel: 'manual', status: 'action_required' });
    const md = await detail(ctx, s, manual.id);
    expect(md.manual.prefillText).toContain('Altro Sito');
    expect(md.manual.url).toBe('https://altro.example.com');

    const limit = await api.post('/requests/custom').send({ profileId: id, name: 'Terzo' }).expect(409);
    expect(limit.body.code).toBe('CUSTOM_LIMIT_REACHED');
    await authed(ctx, await register(ctx)).post('/requests/custom').send({ profileId: id, name: 'Hack' }).expect(404);
  });

  it('requires an active profile', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { body } = await api.post('/profiles').send(profileInput()).expect(201);
    const res = await api.post('/requests/custom').send({ profileId: body.id, name: 'Sito' }).expect(409);
    expect(res.body.code).toBe('PROFILE_NOT_READY');
  });
});

describe('deadlines, reminders, escalation and renewals (time travel)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('marks overdue, sends exactly two reminders, prepares the Garante complaint and renews after completion', async () => {
    const s = await register(ctx);
    const { id: profileId } = await activeProfile(ctx, s);
    const api = authed(ctx, s);
    await ctx.scheduler.tick();
    const form = await requestByBroker(ctx, s, 'form-only');
    await api.post(`/requests/${form.id}/mark-done`).expect(200);
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    const ita = await requestByBroker(ctx, s, 'infoitalia');
    const rpo = await requestByBroker(ctx, s, 'rpo');
    await api.post(`/requests/${rpo.id}/mark-done`).expect(200);

    // Day 29: nothing happens yet.
    ctx.clock.advance(29 * DAY);
    await ctx.scheduler.tick();
    expect((await detail(ctx, s, acme.id)).status).toBe('sent');
    expect(mailsForRef(ctx, acme.shortRef)).toHaveLength(1);

    // Day 31: overdue + first automatic reminder (email channel only).
    ctx.clock.advance(2 * DAY);
    const t1 = await ctx.scheduler.tick();
    expect(t1.overdue).toBeGreaterThanOrEqual(3);
    for (const r of [acme, ita, form]) expect((await detail(ctx, s, r.id)).status).toBe('overdue');
    expect(mailsForRef(ctx, acme.shortRef).map((m) => m.subject)[1]).toMatch(/^Reminder no\. 1 - /);
    expect(mailsForRef(ctx, ita.shortRef).map((m) => m.subject)[1]).toMatch(/^Sollecito n\. 1 e diffida/);
    expect(mailsForRef(ctx, form.shortRef)).toHaveLength(0);
    const itaD = await detail(ctx, s, ita.id);
    expect(itaD).toMatchObject({ canEscalate: true, canRemind: false });
    expect(itaD.timeline.map((t: { type: string }) => t.type)).toEqual(['created', 'sent', 'status_changed', 'reminder_sent']);
    expect((await api.get('/notifications').expect(200)).body.items.some((n: { title: string }) => n.title.includes('nessuna risposta'))).toBe(true);

    // A reminder is not repeated by a second tick.
    await ctx.scheduler.tick();
    expect(mailsForRef(ctx, ita.shortRef)).toHaveLength(2);

    // Escalation prepares the complaint draft.
    const esc = (await api.post(`/requests/${acme.id}/escalate`).expect(200)).body;
    expect(esc.text).toContain('Garante per la protezione dei dati personali');
    expect(esc.text).toContain(acme.shortRef);
    expect(esc.text).toContain('sono stati inviati 1 solleciti');
    expect(esc.steps.length).toBeGreaterThanOrEqual(4);
    expect(esc.pdfUrl).toBe(`/api/v1/requests/${acme.id}/complaint.pdf`);
    expect(esc.submitUrl).toContain('garanteprivacy.it');
    expect((await detail(ctx, s, acme.id)).status).toBe('escalated');
    const pdf = await api.get(`/requests/${acme.id}/complaint.pdf`).expect(200).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await api.post(`/requests/${acme.id}/escalate`).expect(200)).body.text).toBe(esc.text.replace(/\d{4}-\d{2}-\d{2}\n/, (m: string) => m));
    await api.post(`/requests/${rpo.id}/escalate`).expect(409);
    await api.get(`/requests/${rpo.id}/complaint.pdf`).expect(409);

    // Day 47: second (and last) automatic reminder, then no third.
    ctx.clock.advance(16 * DAY);
    await ctx.scheduler.tick();
    expect(mailsForRef(ctx, ita.shortRef)).toHaveLength(3);
    expect(mailsForRef(ctx, ita.shortRef)[2]!.subject).toMatch(/^Sollecito n\. 2 e diffida/);
    ctx.clock.advance(16 * DAY);
    await ctx.scheduler.tick();
    expect(mailsForRef(ctx, ita.shortRef)).toHaveLength(3);

    // The user can still send a manual reminder.
    expect((await detail(ctx, s, ita.id)).canRemind).toBe(true);
    await api.post(`/requests/${ita.id}/reminder`).expect(200);
    expect(mailsForRef(ctx, ita.shortRef)).toHaveLength(4);
    await api.post(`/requests/${ita.id}/reminder`).expect(409);
    await api.post(`/requests/${form.id}/reminder`).expect(409);

    // A late reply completes the request; 90 days later it is renewed exactly once.
    const done = (await api.post(`/requests/${ita.id}/simulate-reply`).send({ kind: 'completed' }).expect(200)).body;
    expect(done.status).toBe('completed');
    ctx.clock.advance(91 * DAY);
    const t2 = await ctx.scheduler.tick();
    expect(t2.renewals).toBeGreaterThanOrEqual(1);
    const cycle2 = await requestByBroker(ctx, s, 'infoitalia', 2);
    expect(cycle2).toMatchObject({ status: 'queued', cycle: 2 });
    expect(cycle2.shortRef).not.toBe(ita.shortRef);
    const old = await detail(ctx, s, ita.id);
    expect(old).toMatchObject({ status: 'completed', nextCheckAt: null });
    expect(old.timeline.at(-1).type).toBe('renewed');
    await ctx.scheduler.tick();
    const sent2 = mailsForRef(ctx, cycle2.shortRef);
    expect(sent2).toHaveLength(1);
    expect(sent2[0]!.text).toContain('richiesta periodica');
    await ctx.scheduler.tick();
    await expect(requestByBroker(ctx, s, 'infoitalia', 3)).rejects.toThrow();

    // The monthly report was generated for the previous month and announced.
    const reports = (await api.get(`/reports?profileId=${profileId}`).expect(200)).body;
    expect(reports.length).toBeGreaterThanOrEqual(1);
    expect(reports[0].period).toMatch(/^\d{4}-\d{2}$/);
    expect((await api.get('/notifications').expect(200)).body.items.some((n: { type: string }) => n.type === 'report')).toBe(true);
  });

  it('does not remind, escalate or renew when the profile is paused or the request was cancelled', async () => {
    const s = await register(ctx);
    const { id } = await activeProfile(ctx, s);
    const api = authed(ctx, s);
    await ctx.scheduler.tick();
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    await api.post(`/profiles/${id}/pause`).expect(200);
    ctx.clock.advance(31 * DAY);
    await ctx.scheduler.tick();
    expect((await detail(ctx, s, acme.id)).status).toBe('overdue');
    expect(mailsForRef(ctx, acme.shortRef)).toHaveLength(1);
    await api.post(`/requests/${acme.id}/cancel`).expect(200);
    ctx.clock.advance(40 * DAY);
    await ctx.scheduler.tick();
    expect(mailsForRef(ctx, acme.shortRef)).toHaveLength(1);
    expect((await listRequests(ctx, s)).items.filter((r) => r.broker.id === 'acme-leads')).toHaveLength(1);
  });
});
