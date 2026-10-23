import { TestCtx, activeProfile, authed, createTestApp, listRequests, profileInput, register } from './helpers';

describe('profiles and authorization', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('blocks profile creation until the email is verified', async () => {
    const s = await register(ctx, undefined, false);
    const res = await authed(ctx, s).post('/profiles').send(profileInput()).expect(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('validates profile input', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    await api.post('/profiles').send(profileInput({ emails: [] })).expect(400);
    await api.post('/profiles').send(profileInput({ emails: ['not-an-email'] })).expect(400);
    await api.post('/profiles').send(profileInput({ emails: Array.from({ length: 6 }, (_, i) => `a${i}@x.it`) })).expect(400);
    await api.post('/profiles').send(profileInput({ phones: ['abc'] })).expect(400);
    await api.post('/profiles').send(profileInput({ dateOfBirth: '2999-01-01' })).expect(400);
    await api.post('/profiles').send(profileInput({ dateOfBirth: '1985-02-31' })).expect(400);
    await api.post('/profiles').send(profileInput({ fiscalCode: 'x' })).expect(400);
    await api.post('/profiles').send(profileInput({ firstName: '' })).expect(400);
    await api.post('/profiles').send(profileInput({ addresses: [{ street: 'x', city: 'y', zip: '1', country: 'ITA' }] })).expect(400);
    await api.post('/profiles').send({ ...profileInput(), isAdmin: true }).expect(400);
  });

  it('creates, reads, normalises and isolates profiles per user', async () => {
    const a = await register(ctx);
    const b = await register(ctx);
    const created = await authed(ctx, a)
      .post('/profiles')
      .send(profileInput({ emails: ['Mario.Rossi@Example.IT', 'mario.rossi@example.it'], fiscalCode: 'rssmra85c12f205z', phones: [] }))
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'draft',
      firstName: 'Mario',
      emails: ['mario.rossi@example.it'],
      fiscalCode: 'RSSMRA85C12F205Z',
      authorization: null,
      requestCounts: { total: 0, inProgress: 0, actionRequired: 0, completed: 0, notRemovable: 0 },
    });
    const id = created.body.id as string;
    expect((await authed(ctx, a).get('/profiles').expect(200)).body).toHaveLength(1);
    await authed(ctx, a).get(`/profiles/${id}`).expect(200);
    await authed(ctx, b).get(`/profiles/${id}`).expect(404);
    await authed(ctx, b).patch(`/profiles/${id}`).send({ lastName: 'Hack' }).expect(404);
    await authed(ctx, b).del(`/profiles/${id}`).expect(404);
    await authed(ctx, a).get('/profiles/not-an-id').expect(400);
    expect((await authed(ctx, b).get('/profiles').expect(200)).body).toHaveLength(0);
  });

  it('stores personal data encrypted at rest', async () => {
    const s = await register(ctx);
    const created = await authed(ctx, s).post('/profiles').send(profileInput({ fiscalCode: 'RSSMRA85C12F205Z' })).expect(201);
    const raw = await ctx.connection.collection('profiles').findOne({ _id: new (await import('mongoose')).Types.ObjectId(created.body.id) });
    expect(typeof raw?.pii).toBe('string');
    expect(String(raw?.pii)).not.toMatch(/Mario|Rossi|RSSMRA/);
    expect(String(raw?.pii)).toMatch(/^v1:/);
  });

  it('enforces the per-user profile limit', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    for (let i = 0; i < 3; i++) await api.post('/profiles').send(profileInput({ firstName: `P${i}` })).expect(201);
    const res = await api.post('/profiles').send(profileInput()).expect(409);
    expect(res.body.code).toBe('PROFILE_LIMIT_REACHED');
  });

  it('requires an exact-name signature, is idempotent and serves the signed PDF', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { body: p } = await api.post('/profiles').send(profileInput()).expect(201);
    const text = (await api.get(`/profiles/${p.id}/authorization/text`).expect(200)).body;
    expect(text.version).toMatch(/^\d{4}-\d{2}-v\d+$/);
    expect(text.text).toContain('Mario Rossi');
    expect(text.text).toContain('art. 17 GDPR');
    expect((await api.get(`/profiles/${p.id}/authorization/pdf`).expect(400)).body.code).toBe('AUTHORIZATION_REQUIRED');
    await api.post(`/profiles/${p.id}/authorization`).send({ signatureName: 'Luigi Verdi', accepted: true }).expect(400);
    await api.post(`/profiles/${p.id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: false }).expect(400);
    const first = await api.post(`/profiles/${p.id}/authorization`).send({ signatureName: '  mario   ROSSI ', accepted: true }).expect(201);
    expect(first.body).toMatchObject({ signatureName: 'Mario Rossi', revokedAt: null });
    const again = await api.post(`/profiles/${p.id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect((await api.get(`/profiles/${p.id}`).expect(200)).body.status).toBe('ready');
    const pdf = await api.get(`/profiles/${p.id}/authorization/pdf`).expect(200).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('activates only after signing, once, and queues email + manual requests', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { body: p } = await api.post('/profiles').send(profileInput()).expect(201);
    expect((await api.post(`/profiles/${p.id}/activate`).expect(409)).body.code).toBe('PROFILE_NOT_READY');
    await api.post(`/profiles/${p.id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
    const act = await api.post(`/profiles/${p.id}/activate`).expect(200);
    expect(act.body).toMatchObject({ emailRequests: 2, manualActions: 2, dailyEmailBatchSize: 5 });
    expect((await api.post(`/profiles/${p.id}/activate`).expect(409)).body.code).toBe('INVALID_STATE');
    const profile = (await api.get(`/profiles/${p.id}`).expect(200)).body;
    expect(profile).toMatchObject({ status: 'active', requestCounts: { total: 4, inProgress: 2, actionRequired: 2 } });
    expect(profile.activatedAt).not.toBeNull();
    const reqs = await listRequests(ctx, s);
    expect(reqs.total).toBe(4);
    expect(reqs.items.map((r) => r.broker.id).sort()).toEqual(['acme-leads', 'form-only', 'infoitalia', 'rpo']);
    expect(reqs.items.find((r) => r.broker.id === 'rpo')).toMatchObject({ channel: 'manual', status: 'action_required', actionReason: 'manual_steps' });
    expect(reqs.items.find((r) => r.broker.id === 'form-only')).toMatchObject({ channel: 'manual', actionReason: 'manual_form' });
    expect(reqs.items.find((r) => r.broker.id === 'acme-leads')).toMatchObject({ channel: 'email', status: 'queued', cycle: 1, dryRun: false });
  });

  it('pauses and resumes only from the right state', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { id } = await activeProfile(ctx, s);
    await api.post(`/profiles/${id}/resume`).expect(409);
    expect((await api.post(`/profiles/${id}/pause`).expect(200)).body.status).toBe('paused');
    await api.post(`/profiles/${id}/pause`).expect(409);
    expect((await api.post(`/profiles/${id}/resume`).expect(200)).body.status).toBe('active');
  });

  it('cancels pending requests when the delega is revoked and revives them on re-activation', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { id } = await activeProfile(ctx, s);
    await api.del(`/profiles/${id}/authorization`).expect(204);
    const profile = (await api.get(`/profiles/${id}`).expect(200)).body;
    expect(profile).toMatchObject({ status: 'draft', authorization: null });
    expect(profile.requestCounts).toMatchObject({ total: 4, notRemovable: 4 });
    await ctx.scheduler.tick(); // other users' queued requests may be sent, never this one
    expect((await api.get(`/profiles/${id}`).expect(200)).body.requestCounts).toMatchObject({ total: 4, notRemovable: 4 });
    const detail = await api.get(`/requests/${(await listRequests(ctx, s)).items[0]?.id}`).expect(200);
    expect(detail.body.messages).toHaveLength(0);
    await api.post(`/profiles/${id}/activate`).expect(409);
    await api.post(`/profiles/${id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
    const act = await api.post(`/profiles/${id}/activate`).expect(200);
    expect(act.body).toEqual({ emailRequests: 2, manualActions: 2 });
    expect((await authed(ctx, s).get(`/profiles/${id}`).expect(200)).body.requestCounts).toMatchObject({ total: 4, inProgress: 2, actionRequired: 2, notRemovable: 0 });
  });

  it('invalidates the delega when the name changes', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { id } = await activeProfile(ctx, s);
    const upd = await api.patch(`/profiles/${id}`).send({ lastName: 'Bianchi' }).expect(200);
    expect(upd.body).toMatchObject({ lastName: 'Bianchi', status: 'draft', authorization: null });
    const keep = await api.patch(`/profiles/${id}`).send({ phones: ['+39 02 1234567'] }).expect(200);
    expect(keep.body.phones).toEqual(['+39 02 1234567']);
  });

  it('deletes a profile with all its requests', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { id } = await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    await api.del(`/profiles/${id}`).expect(204);
    await api.get(`/profiles/${id}`).expect(404);
    expect((await listRequests(ctx, s)).total).toBe(0);
  });
});
