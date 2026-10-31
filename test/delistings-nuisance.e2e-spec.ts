import { DAY, TestCtx, activeProfile, authed, binaryParser, createTestApp, profileInput, register, requestByBroker } from './helpers';

describe('search-engine delisting', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const input = (profileId: string, extra: Record<string, unknown> = {}) => ({
    profileId,
    engine: 'google',
    url: 'https://example.com/old-article',
    searchQuery: 'Mario Rossi',
    reason: 'outdated',
    explanation: 'Articolo del 2009 su una vicenda archiviata.',
    ...extra,
  });

  it('creates requests, validates input and isolates users', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { body: p } = await api.post('/profiles').send(profileInput()).expect(201);
    await api.post('/delistings').send(input(p.id, { url: 'not a url' })).expect(400);
    await api.post('/delistings').send(input(p.id, { url: 'ftp://example.com/x' })).expect(400);
    await api.post('/delistings').send(input(p.id, { reason: 'because' })).expect(400);
    await api.post('/delistings').send(input(p.id, { engine: 'yahoo' })).expect(400);
    const created = (await api.post('/delistings').send(input(p.id)).expect(201)).body;
    expect(created).toMatchObject({ engine: 'google', status: 'to_submit', submittedAt: null, followUpAt: null, searchQuery: 'Mario Rossi' });
    await api.post('/delistings').send(input(p.id, { engine: 'bing', searchQuery: undefined, explanation: undefined })).expect(201);

    const list = (await api.get('/delistings').expect(200)).body;
    expect(list).toMatchObject({ total: 2, page: 1, limit: 20 });
    expect((await api.get(`/delistings?profileId=${p.id}&status=to_submit&limit=1`).expect(200)).body).toMatchObject({ total: 2, limit: 1 });
    expect((await api.get('/delistings?status=approved').expect(200)).body.total).toBe(0);
    const other = await register(ctx);
    await authed(ctx, other).get(`/delistings/${created.id}`).expect(404);
    await authed(ctx, other).patch(`/delistings/${created.id}`).send({ status: 'cancelled' }).expect(404);
    await authed(ctx, other).post('/delistings').send(input(p.id)).expect(404);
    expect((await authed(ctx, other).get('/delistings').expect(200)).body.total).toBe(0);
  });

  it('prepares a guide per search engine with the official form and a ready statement', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { body: p } = await api.post('/profiles').send(profileInput()).expect(201);
    const g = (await api.post('/delistings').send(input(p.id)).expect(201)).body;
    const guide = (await api.get(`/delistings/${g.id}/guide`).expect(200)).body;
    expect(guide).toMatchObject({ engineName: 'Google', formUrl: 'https://reportcontent.google.com/forms/rtbf' });
    expect(guide.steps.join(' ')).toContain('https://example.com/old-article');
    expect(guide.statement).toContain('Mario Rossi');
    expect(guide.statement).toContain('https://example.com/old-article');
    expect(guide.statement).toContain('art. 17');
    expect(guide.statement).toContain('obsolete');
    expect(guide.statement).toContain('Articolo del 2009');
    expect(guide.tips.length).toBeGreaterThan(1);
    const b = (await api.post('/delistings').send(input(p.id, { engine: 'bing', searchQuery: undefined })).expect(201)).body;
    const bing = (await api.get(`/delistings/${b.id}/guide`).expect(200)).body;
    expect(bing).toMatchObject({ engineName: 'Bing', formUrl: 'https://www.bing.com/webmaster/tools/eu-privacy-request' });
    expect(bing.statement).toContain('«Mario Rossi»'); // defaults to the person's name
    const o = (await api.post('/delistings').send(input(p.id, { engine: 'other' })).expect(201)).body;
    expect((await api.get(`/delistings/${o.id}/guide`).expect(200)).body.formUrl).toBeNull();
  });

  it('follows the allowed status transitions, schedules a follow-up and reminds once', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { body: p } = await api.post('/profiles').send(profileInput()).expect(201);
    const d = (await api.post('/delistings').send(input(p.id)).expect(201)).body;
    expect((await api.patch(`/delistings/${d.id}`).send({ status: 'approved' }).expect(409)).body.code).toBe('INVALID_STATE');
    await api.patch(`/delistings/${d.id}`).send({ status: 'bogus' }).expect(400);
    const submitted = (await api.patch(`/delistings/${d.id}`).send({ status: 'submitted', note: 'inviata il 3 ottobre' }).expect(200)).body;
    expect(submitted).toMatchObject({ status: 'submitted', note: 'inviata il 3 ottobre' });
    expect(new Date(submitted.followUpAt).getTime() - new Date(submitted.submittedAt).getTime()).toBe(30 * DAY);

    ctx.clock.advance(31 * DAY);
    await ctx.scheduler.tick();
    await ctx.scheduler.tick();
    const reminders = (await api.get('/notifications').expect(200)).body.items.filter((n: { title: string }) => n.title.includes('risposta alla richiesta di deindicizzazione'));
    expect(reminders).toHaveLength(1);

    const denied = (await api.patch(`/delistings/${d.id}`).send({ status: 'denied' }).expect(200)).body;
    expect(denied).toMatchObject({ status: 'denied', followUpAt: null });
    expect(denied.resolvedAt).not.toBeNull();
    await api.patch(`/delistings/${d.id}`).send({ status: 'submitted' }).expect(409);
    const appealed = (await api.patch(`/delistings/${d.id}`).send({ status: 'appealed' }).expect(200)).body;
    expect(appealed).toMatchObject({ status: 'appealed', resolvedAt: null });
    expect(appealed.followUpAt).not.toBeNull();
    expect((await api.patch(`/delistings/${d.id}`).send({ status: 'approved' }).expect(200)).body.status).toBe('approved');
    await api.patch(`/delistings/${d.id}`).send({ status: 'cancelled' }).expect(409); // finished
    const note = (await api.patch(`/delistings/${d.id}`).send({ note: 'rimossa' }).expect(200)).body;
    expect(note.note).toBe('rimossa');

    await api.del(`/delistings/${d.id}`).expect(204);
    await api.get(`/delistings/${d.id}`).expect(404);
  });

  it('can be switched off by the operator', async () => {
    process.env.FEATURES_DISABLED = 'delisting';
    const off = await createTestApp();
    try {
      const s = await register(off);
      expect((await authed(off, s).get('/delistings').expect(404)).body.code).toBe('FEATURE_DISABLED');
    } finally {
      delete process.env.FEATURES_DISABLED;
      await off.close();
    }
  });
});

describe('telemarketing defence', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  const report = (profileId: string, extra: Record<string, unknown> = {}) => ({
    profileId,
    channel: 'call',
    callerNumber: '+39 02 1234567',
    company: 'Energia Facile',
    receivedAt: ctx.clock.now().toISOString(),
    summary: 'Offerta luce e gas',
    ...extra,
  });

  it('records unwanted contacts (encrypted), groups callers and validates input', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { id } = await activeProfile(ctx, s);
    const empty = (await api.get(`/nuisance?profileId=${id}`).expect(200)).body;
    expect(empty).toMatchObject({ rpo: { registered: false, requestId: null, completedAt: null, effectiveFrom: null }, reports: [], topCallers: [] });

    await api.post('/nuisance').send(report(id, { channel: 'fax' })).expect(400);
    await api.post('/nuisance').send(report(id, { receivedAt: 'yesterday' })).expect(400);
    await api.post('/nuisance').send(report(id, { consentGiven: 'yes' })).expect(400);
    const r1 = (await api.post('/nuisance').send(report(id)).expect(201)).body;
    expect(r1).toMatchObject({ channel: 'call', callerNumber: '+39 02 1234567', company: 'Energia Facile', consentGiven: 'unknown', rpoActiveAtTime: null });
    await api.post('/nuisance').send(report(id, { callerNumber: '0212345 67', company: 'energia facile', consentGiven: 'no' })).expect(201);
    await api.post('/nuisance').send(report(id, { channel: 'sms', callerNumber: undefined, company: undefined, summary: undefined })).expect(201);

    const overview = (await api.get(`/nuisance?profileId=${id}`).expect(200)).body;
    expect(overview.reports).toHaveLength(3);
    expect(overview.topCallers[0].count).toBe(2);
    expect(overview.topCallers[0].company).toMatch(/energia facile/i);
    expect(JSON.stringify(await ctx.connection.collection('nuisancereports').find({}).toArray())).not.toMatch(/Energia Facile|1234567|Offerta luce/);

    const other = await register(ctx);
    await authed(ctx, other).get(`/nuisance?profileId=${id}`).expect(404);
    await authed(ctx, other).post('/nuisance').send(report(id)).expect(404);
    await authed(ctx, other).del(`/nuisance/${r1.id}`).expect(404);
    await api.del(`/nuisance/${r1.id}`).expect(204);
    expect((await api.get(`/nuisance?profileId=${id}`).expect(200)).body.reports).toHaveLength(2);
  });

  it('knows whether the RPO registration was in force and reminds after 15 days', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { id } = await activeProfile(ctx, s);
    const rpo = await requestByBroker(ctx, s, 'rpo');
    await api.post(`/requests/${rpo.id}/mark-done`).expect(200);
    const o = (await api.get(`/nuisance?profileId=${id}`).expect(200)).body;
    expect(o.rpo).toMatchObject({ registered: true, requestId: rpo.id });
    expect(new Date(o.rpo.effectiveFrom).getTime() - new Date(o.rpo.completedAt).getTime()).toBe(15 * DAY);

    const early = (await api.post('/nuisance').send(report(id, { receivedAt: new Date(ctx.clock.now().getTime() + 5 * DAY).toISOString() })).expect(201)).body;
    const late = (await api.post('/nuisance').send(report(id, { receivedAt: new Date(ctx.clock.now().getTime() + 20 * DAY).toISOString() })).expect(201)).body;
    expect(early.rpoActiveAtTime).toBe(false);
    expect(late.rpoActiveAtTime).toBe(true);

    ctx.clock.advance(16 * DAY);
    await ctx.scheduler.tick();
    await ctx.scheduler.tick();
    const notes = (await api.get('/notifications').expect(200)).body.items.filter((n: { title: string }) => n.title.includes('Registro delle Opposizioni è ora efficace'));
    expect(notes).toHaveLength(1);
    expect(notes[0].requestId).toBe(rpo.id);
  });

  it('prepares the complaint to the Garante with text and PDF', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { id } = await activeProfile(ctx, s);
    expect((await api.post('/nuisance/complaint').send({ profileId: id }).expect(409)).body.code).toBe('INVALID_STATE');
    const rpo = await requestByBroker(ctx, s, 'rpo');
    await api.post(`/requests/${rpo.id}/mark-done`).expect(200);
    await api.post('/nuisance').send(report(id, { receivedAt: new Date(ctx.clock.now().getTime() + 20 * DAY).toISOString() })).expect(201);
    await api.post('/nuisance').send(report(id, { channel: 'sms', callerNumber: '+39 333 000111', company: 'Telco Offerte', summary: 'Promozione' })).expect(201);

    const c = (await api.post('/nuisance/complaint').send({ profileId: id }).expect(200)).body;
    expect(c.text).toContain('art. 144 del D.Lgs. 196/2003');
    expect(c.text).toContain('Mario Rossi');
    expect(c.text).toContain('+39 02 1234567');
    expect(c.text).toContain('Energia Facile');
    expect(c.text).toContain('Telco Offerte');
    expect(c.text).toContain('Registro Pubblico delle Opposizioni (RPO) dal');
    expect(c.text).toContain('[iscrizione al RPO già efficace]');
    expect(c.pdfUrl).toBe(`/api/v1/nuisance/complaint.pdf?profileId=${id}`);
    expect(c.steps.length).toBeGreaterThanOrEqual(4);
    expect(c.submitUrl).toContain('garanteprivacy.it');
    const pdf = await api.get(`/nuisance/complaint.pdf?profileId=${id}`).buffer(true).parse(binaryParser).expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const subset = (await api.get(`/nuisance?profileId=${id}`).expect(200)).body.reports[0];
    const only = (await api.post('/nuisance/complaint').send({ profileId: id, reportIds: [subset.id] }).expect(200)).body;
    expect(only.text).toMatch(/di aver ricevuto 1 comunicazion[ei] promozional/);
    await authed(ctx, await register(ctx)).post('/nuisance/complaint').send({ profileId: id }).expect(404);
  });

  it('can be switched off by the operator', async () => {
    process.env.FEATURES_DISABLED = 'nuisance';
    const off = await createTestApp();
    try {
      const s = await register(off);
      expect((await authed(off, s).get('/nuisance?profileId=aaaaaaaaaaaaaaaaaaaaaaaa').expect(404)).body.code).toBe('FEATURE_DISABLED');
    } finally {
      delete process.env.FEATURES_DISABLED;
      await off.close();
    }
  });
});
