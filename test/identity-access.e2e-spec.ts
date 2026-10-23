import { Webhook } from 'standardwebhooks';
import { SmsService } from '../src/identity/sms.service';
import { DAY, TestCtx, activeProfile, authed, binaryParser, createTestApp, detail, listRequests, mailsForRef, profileInput, register } from './helpers';

type Sess = Awaited<ReturnType<typeof register>>;
const EMAIL = 'mario.rossi@example.it';
const PHONE = '+39 333 1234567';

const lastCode = (ctx: TestCtx, to: string): string => {
  const mails = ctx.mail.to(to).filter((m) => /codice di verifica/i.test(m.subject));
  const m = /(\d{6})/.exec(mails[mails.length - 1]?.subject ?? '');
  if (!m) throw new Error('no code mail');
  return m[1] as string;
};

async function verifyAllEmails(ctx: TestCtx, s: Sess, profileId: string, email = EMAIL) {
  const api = authed(ctx, s);
  await api.post(`/profiles/${profileId}/identity/send-code`).send({ type: 'email', value: email }).expect(204);
  return api.post(`/profiles/${profileId}/identity/confirm`).send({ type: 'email', value: email, code: lastCode(ctx, email) }).expect(200);
}

describe('identity (contact ownership)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('verifies an email with a code, with cooldown, attempt limits and expiry', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { body } = await api.post('/profiles').send(profileInput()).expect(201);
    const id = body.id as string;
    expect(body).toMatchObject({ identityVerified: false, senderMode: 'cancellamy' });
    const before = (await api.get(`/profiles/${id}/identity`).expect(200)).body;
    expect(before).toMatchObject({ verified: false, requiresPhone: false });
    expect(before.contacts).toEqual([
      { type: 'email', value: EMAIL, verified: false, verifiedAt: null },
      { type: 'phone', value: PHONE, verified: false, verifiedAt: null },
    ]);

    await api.post(`/profiles/${id}/identity/send-code`).send({ type: 'email', value: 'someone@else.it' }).expect(400);
    await api.post(`/profiles/${id}/identity/send-code`).send({ type: 'phone', value: PHONE }).expect(400); // no SMS provider
    await api.post(`/profiles/${id}/identity/send-code`).send({ type: 'email', value: EMAIL.toUpperCase() }).expect(204);
    const code = lastCode(ctx, EMAIL);
    expect(code).toMatch(/^\d{6}$/);
    expect((await api.post(`/profiles/${id}/identity/send-code`).send({ type: 'email', value: EMAIL }).expect(429)).body.code).toBe('VERIFICATION_RATE_LIMITED');
    expect((await api.post(`/profiles/${id}/identity/confirm`).send({ type: 'email', value: EMAIL, code: code === '000000' ? '111111' : '000000' }).expect(400)).body.code).toBe('VERIFICATION_CODE_INVALID');
    await api.post(`/profiles/${id}/identity/confirm`).send({ type: 'email', value: EMAIL, code: 'abc' }).expect(400);

    const done = await api.post(`/profiles/${id}/identity/confirm`).send({ type: 'email', value: EMAIL, code }).expect(200);
    expect(done.body.verified).toBe(true); // phones are optional when the instance has no SMS provider
    expect(done.body.contacts[0]).toMatchObject({ type: 'email', verified: true });
    expect((await api.get(`/profiles/${id}`).expect(200)).body.identityVerified).toBe(true);
    await api.post(`/profiles/${id}/identity/confirm`).send({ type: 'email', value: EMAIL, code }).expect(400); // codes are single use
  });

  it('throttles repeated codes, locks after wrong attempts and expires codes', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { body } = await api.post('/profiles').send(profileInput()).expect(201);
    const id = body.id as string;
    for (let i = 0; i < 5; i++) {
      await api.post(`/profiles/${id}/identity/send-code`).send({ type: 'email', value: EMAIL }).expect(204);
      ctx.clock.advance(61_000);
    }
    expect((await api.post(`/profiles/${id}/identity/send-code`).send({ type: 'email', value: EMAIL }).expect(429)).body.code).toBe('VERIFICATION_RATE_LIMITED');
    ctx.clock.advance(61 * 60_000); // new window
    await api.post(`/profiles/${id}/identity/send-code`).send({ type: 'email', value: EMAIL }).expect(204);
    const good = lastCode(ctx, EMAIL);
    const wrong = good === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await api.post(`/profiles/${id}/identity/confirm`).send({ type: 'email', value: EMAIL, code: wrong }).expect(400);
    expect((await api.post(`/profiles/${id}/identity/confirm`).send({ type: 'email', value: EMAIL, code: good }).expect(429)).body.code).toBe('VERIFICATION_RATE_LIMITED');
    ctx.clock.advance(61_000);
    await api.post(`/profiles/${id}/identity/send-code`).send({ type: 'email', value: EMAIL }).expect(204);
    const fresh = lastCode(ctx, EMAIL);
    ctx.clock.advance(16 * 60_000);
    expect((await api.post(`/profiles/${id}/identity/confirm`).send({ type: 'email', value: EMAIL, code: fresh }).expect(400)).body.code).toBe('VERIFICATION_CODE_INVALID');
  });

  it("keeps identities private and requires re-verification when an email changes", async () => {
    const a = await register(ctx);
    const b = await register(ctx);
    const { body } = await authed(ctx, a).post('/profiles').send(profileInput()).expect(201);
    await verifyAllEmails(ctx, a, body.id);
    await authed(ctx, b).get(`/profiles/${body.id}/identity`).expect(404);
    await authed(ctx, b).post(`/profiles/${body.id}/identity/send-code`).send({ type: 'email', value: EMAIL }).expect(404);
    const upd = await authed(ctx, a).patch(`/profiles/${body.id}`).send({ emails: [EMAIL, 'new@example.it'] }).expect(200);
    expect(upd.body.identityVerified).toBe(false);
    const status = (await authed(ctx, a).get(`/profiles/${body.id}/identity`).expect(200)).body;
    expect(status.contacts.find((c: { value: string }) => c.value === 'new@example.it').verified).toBe(false);
    expect(status.contacts.find((c: { value: string }) => c.value === EMAIL).verified).toBe(true);
  });
});

describe('identity with an SMS provider', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    process.env.SMS_PROVIDER = 'dry-run';
    ctx = await createTestApp();
  });
  afterAll(async () => {
    delete process.env.SMS_PROVIDER;
    await ctx.close();
  });

  it('requires every phone to be verified too', async () => {
    expect((await ctx.http().get('/api/v1/config').expect(200)).body.features.identityPhone).toBe(true);
    const s = await register(ctx);
    const api = authed(ctx, s);
    const { body } = await api.post('/profiles').send(profileInput()).expect(201);
    const id = body.id as string;
    const sms = jest.spyOn(ctx.app.get(SmsService), 'send').mockResolvedValue();
    try {
      const afterEmail = await verifyAllEmails(ctx, s, id);
      expect(afterEmail.body).toMatchObject({ verified: false, requiresPhone: true });
      await api.post(`/profiles/${id}/identity/send-code`).send({ type: 'phone', value: '+39 333-1234567' }).expect(204);
      expect(sms).toHaveBeenCalledTimes(1);
      const [to, text] = sms.mock.calls[0] as [string, string];
      expect(to).toBe(PHONE);
      const code = /(\d{6})/.exec(text)?.[1] as string;
      const done = await api.post(`/profiles/${id}/identity/confirm`).send({ type: 'phone', value: PHONE, code }).expect(200);
      expect(done.body.verified).toBe(true);
    } finally {
      sms.mockRestore();
    }
  });
});

describe('right of access ("Cosa sai di me")', () => {
  let ctx: TestCtx;
  let fetchMock: jest.SpyInstance;
  const received: Record<string, Record<string, unknown>> = {};
  const FILE = Buffer.from('%PDF-1.4 export of your data: name, email, phone');
  const HTML = Buffer.from('<html><script>alert(1)</script></html>');

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://files.example/pdf') return new Response(new Uint8Array(FILE), { status: 200 });
      if (url === 'https://files.example/html') return new Response(new Uint8Array(HTML), { status: 200 });
      const path = url.replace('https://api.resend.com/emails/receiving/', '').split('/');
      const id = decodeURIComponent(path[0] as string);
      if (path[1] === 'attachments') {
        const list = (received[id]?.attachments ?? []) as Array<{ filename: string; content_type: string; size: number; url: string }>;
        return new Response(JSON.stringify({ data: list.map((a) => ({ filename: a.filename, content_type: a.content_type, size: a.size, download_url: a.url })) }), { status: 200 });
      }
      return new Response(JSON.stringify(received[id] ?? {}), { status: 200 });
    });
  });
  afterEach(() => fetchMock.mockRestore());

  async function verified(): Promise<{ s: Sess; id: string }> {
    const s = await register(ctx);
    const created = await authed(ctx, s).post('/profiles').send(profileInput()).expect(201);
    const id = created.body.id as string;
    await authed(ctx, s).post(`/profiles/${id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
    await authed(ctx, s).post(`/profiles/${id}/activate`).expect(200);
    await verifyAllEmails(ctx, s, id);
    return { s, id };
  }

  const webhook = (ctx2: TestCtx, emailId: string) => {
    const payload = JSON.stringify({ type: 'email.received', data: { email_id: emailId } });
    const id = `msg_${emailId}_${Date.now()}`;
    const when = new Date();
    const sig = new Webhook(process.env.RESEND_WEBHOOK_SECRET as string).sign(id, when, payload);
    return ctx2
      .http()
      .post('/api/v1/webhooks/resend')
      .set({ 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(Math.floor(when.getTime() / 1000)), 'svix-signature': sig })
      .send(payload);
  };

  it('is blocked until the profile is active and the contacts are verified', async () => {
    const s = await register(ctx);
    const api = authed(ctx, s);
    const created = await api.post('/profiles').send(profileInput()).expect(201);
    expect((await api.post('/requests/access').send({ profileId: created.body.id, brokerIds: ['acme-leads'] }).expect(409)).body.code).toBe('PROFILE_NOT_READY');
    const { s: s2, id } = await (async () => {
      const u = await register(ctx);
      const r = await activeProfile(ctx, u);
      return { s: u, id: r.id };
    })();
    const res = await authed(ctx, s2).post('/requests/access').send({ profileId: id, brokerIds: ['acme-leads'] }).expect(403);
    expect(res.body.code).toBe('IDENTITY_REQUIRED');
    await authed(ctx, s2).post('/requests/access').send({ profileId: id, brokerIds: [] }).expect(400);
    await authed(ctx, s2).post('/requests/access').send({ profileId: id, brokerIds: Array.from({ length: 21 }, (_, i) => `b${i}`) }).expect(400);
  });

  it('creates access requests next to the erasure ones, sends art. 15 emails and never renews them', async () => {
    const { s, id } = await verified();
    const api = authed(ctx, s);
    const res = await api.post('/requests/access').send({ profileId: id, brokerIds: ['acme-leads', 'infoitalia', 'form-only', 'rpo', 'garante', 'not-yet', 'missing', 'acme-leads'] }).expect(201);
    expect(res.body.created.map((r: { broker: { id: string } }) => r.broker.id).sort()).toEqual(['acme-leads', 'form-only', 'infoitalia']);
    expect(res.body.created.every((r: { kind: string }) => r.kind === 'access')).toBe(true);
    expect(res.body.skipped).toEqual(
      expect.arrayContaining([
        { brokerId: 'rpo', reason: 'not_contactable' },
        { brokerId: 'garante', reason: 'not_contactable' },
        { brokerId: 'not-yet', reason: 'not_contactable' },
        { brokerId: 'missing', reason: 'not_found' },
      ]),
    );
    const again = await api.post('/requests/access').send({ profileId: id, brokerIds: ['acme-leads'] }).expect(201);
    expect(again.body).toMatchObject({ created: [], skipped: [{ brokerId: 'acme-leads', reason: 'exists' }] });

    expect((await listRequests(ctx, s, 'kind=access')).total).toBe(3);
    expect((await listRequests(ctx, s, 'kind=erasure')).total).toBe(4);
    expect((await listRequests(ctx, s)).total).toBe(7);
    expect((await api.get('/requests/summary').expect(200)).body.counts.total).toBe(4); // the dashboard measures removals only
    expect((await api.get(`/profiles/${id}`).expect(200)).body.requestCounts.total).toBe(4);

    await ctx.scheduler.tick();
    const acme = (await listRequests(ctx, s, 'kind=access')).items.find((r) => r.broker.id === 'acme-leads') as { id: string; shortRef: string };
    const ita = (await listRequests(ctx, s, 'kind=access')).items.find((r) => r.broker.id === 'infoitalia') as { id: string; shortRef: string };
    const mail = mailsForRef(ctx, acme.shortRef);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toContain('GDPR access request (Art. 15)');
    expect(mail[0]!.text).toContain('Article 15 GDPR');
    expect(mail[0]!.idempotencyKey).toBe(`req-${acme.id}-access`);
    expect(mailsForRef(ctx, ita.shortRef)[0]!.subject).toContain('Richiesta di accesso ai dati personali (art. 15 GDPR)');
    expect(mailsForRef(ctx, ita.shortRef)[0]!.text).not.toContain('cancellazione');

    const form = (await listRequests(ctx, s, 'kind=access')).items.find((r) => r.broker.id === 'form-only') as { id: string };
    const manual = await detail(ctx, s, form.id);
    expect(manual).toMatchObject({ kind: 'access', status: 'action_required' });
    expect(manual.manual.prefillText).toContain("diritto di accesso previsto dall'art. 15");

    // Reply with the data: completed, no renewal even after 90 days.
    const done = (await api.post(`/requests/${acme.id}/simulate-reply`).send({ kind: 'completed' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'completed', nextCheckAt: null, findings: null });
    expect(done.messages.find((m: { direction: string }) => m.direction === 'in').classification).toBe('data_provided');
    expect((await api.get('/notifications').expect(200)).body.items.some((n: { title: string }) => n.title.includes('ha risposto con i tuoi dati'))).toBe(true);
    ctx.clock.advance(100 * DAY);
    await ctx.scheduler.tick();
    expect((await listRequests(ctx, s, 'kind=access')).items.filter((r) => r.broker.id === 'acme-leads')).toHaveLength(1);
  });

  it('records findings and builds the data map', async () => {
    const { s, id } = await verified();
    const api = authed(ctx, s);
    await api.post('/requests/access').send({ profileId: id, brokerIds: ['acme-leads', 'infoitalia'] }).expect(201);
    await ctx.scheduler.tick();
    const items = (await listRequests(ctx, s, 'kind=access')).items;
    const acme = items.find((r) => r.broker.id === 'acme-leads') as { id: string };
    const ita = items.find((r) => r.broker.id === 'infoitalia') as { id: string };
    const erasure = (await listRequests(ctx, s, 'kind=erasure')).items.find((r) => r.broker.id === 'acme-leads') as { id: string };
    expect((await api.put(`/requests/${erasure.id}/findings`).send({ found: true, categories: ['contacts'] }).expect(409)).body.code).toBe('INVALID_STATE');
    await api.put(`/requests/${acme.id}/findings`).send({ found: true, categories: ['nope'] }).expect(400);
    await api.put(`/requests/${acme.id}/findings`).send({ found: 'yes', categories: [] }).expect(400);

    const d = (await api.put(`/requests/${acme.id}/findings`).send({ found: true, categories: ['contacts', 'addresses', 'contacts'], note: 'vedo anche il mio telefono' }).expect(200)).body;
    expect(d.findings).toMatchObject({ found: true, categories: ['contacts', 'addresses'], note: 'vedo anche il mio telefono' });
    await api.put(`/requests/${ita.id}/findings`).send({ found: false, categories: ['contacts'] }).expect(200);
    const map = (await api.get(`/profiles/${id}/data-map`).expect(200)).body;
    expect(map.totals).toEqual({ asked: 2, answered: 2, found: 1, notFound: 1 });
    expect(map.categoryCounts).toEqual(expect.arrayContaining([{ category: 'contacts', count: 1 }, { category: 'addresses', count: 1 }]));
    expect(map.entries.map((e: { broker: { id: string } }) => e.broker.id)).toEqual(['acme-leads', 'infoitalia']);
    expect(map.entries.find((e: { found: boolean | null; categories: string[] }) => e.found === false).categories).toEqual([]);
    await authed(ctx, await register(ctx)).get(`/profiles/${id}/data-map`).expect(404);
    expect(JSON.stringify(await ctx.connection.collection('removalrequests').find({ kind: 'access' }).toArray())).not.toContain('vedo anche il mio telefono');
  });

  it('keeps the files sent by a broker encrypted, serves them safely and expires them', async () => {
    const { s, id } = await verified();
    const api = authed(ctx, s);
    await api.post('/requests/access').send({ profileId: id, brokerIds: ['acme-leads'] }).expect(201);
    await ctx.scheduler.tick();
    const acme = (await listRequests(ctx, s, 'kind=access')).items[0] as { id: string; shortRef: string };
    const mail = mailsForRef(ctx, acme.shortRef)[0]!;
    received['em_data1'] = {
      id: 'em_data1',
      from: 'privacy@acmeleads.com',
      to: [mail.replyTo],
      subject: `Re: [${acme.shortRef}]`,
      text: 'In allegato trovate la copia dei suoi dati personali.',
      created_at: new Date().toISOString(),
      attachments: [
        { filename: 'dati.pdf', content_type: 'application/pdf', size: FILE.length, url: 'https://files.example/pdf' },
        { filename: 'pagina.html', content_type: 'text/html', size: HTML.length, url: 'https://files.example/html' },
      ],
    };
    await webhook(ctx, 'em_data1').expect(200);
    const d = await detail(ctx, s, acme.id);
    expect(d.status).toBe('completed');
    const message = d.messages.find((m: { direction: string }) => m.direction === 'in');
    expect(message.classification).toBe('data_provided');
    expect(message.attachments).toHaveLength(2);
    expect(message.attachments[0]).toMatchObject({ filename: 'dati.pdf', downloadable: true });
    expect(new Date(message.attachments[0].expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);

    const pdf = await api.get(`/requests/${acme.id}/messages/${message.id}/attachments/${message.attachments[0].id}`).buffer(true).parse(binaryParser).expect(200);
    expect((pdf.body as Buffer).equals(FILE)).toBe(true);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.headers['content-disposition']).toContain('attachment');
    expect(pdf.headers['x-content-type-options']).toBe('nosniff');
    const html = await api.get(`/requests/${acme.id}/messages/${message.id}/attachments/${message.attachments[1].id}`).buffer(true).parse(binaryParser).expect(200);
    expect(html.headers['content-type']).toMatch(/application\/octet-stream/); // never served as HTML
    expect(JSON.stringify(await ctx.connection.collection('attachmentfiles').find({}).toArray())).not.toContain('export of your data');

    await authed(ctx, await register(ctx)).get(`/requests/${acme.id}/messages/${message.id}/attachments/${message.attachments[0].id}`).expect(404);
    const outgoing = d.messages.find((m: { direction: string }) => m.direction === 'out');
    expect(outgoing.attachments[0].downloadable).toBe(false);
    await api.get(`/requests/${acme.id}/messages/${outgoing.id}/attachments/${outgoing.attachments[0].id}`).expect(404);

    ctx.clock.advance(31 * DAY);
    await api.get(`/requests/${acme.id}/messages/${message.id}/attachments/${message.attachments[0].id}`).expect(404);
    const later = await detail(ctx, s, acme.id);
    expect(later.messages.find((m: { direction: string }) => m.direction === 'in').attachments[0].downloadable).toBe(false);
  });

  it('understands "we hold no data" and legal refusals on access requests', async () => {
    const { s, id } = await verified();
    const api = authed(ctx, s);
    await api.post('/requests/access').send({ profileId: id, brokerIds: ['acme-leads', 'infoitalia'] }).expect(201);
    await ctx.scheduler.tick();
    const items = (await listRequests(ctx, s, 'kind=access')).items;
    const acme = items.find((r) => r.broker.id === 'acme-leads') as { id: string; shortRef: string };
    const ita = items.find((r) => r.broker.id === 'infoitalia') as { id: string; shortRef: string };
    const reply = (rid: string, to: string, ref: string, from: string, text: string) => {
      received[rid] = { id: rid, from, to: [to], subject: `Re: [${ref}]`, text, created_at: new Date().toISOString() };
      return webhook(ctx, rid).expect(200);
    };
    await reply('em_nodata', mailsForRef(ctx, acme.shortRef)[0]!.replyTo as string, acme.shortRef, 'privacy@acmeleads.com', 'We do not hold any personal data about you.');
    const d1 = await detail(ctx, s, acme.id);
    expect(d1).toMatchObject({ status: 'completed', findings: { found: false, categories: [] } });
    expect(d1.messages.find((m: { direction: string }) => m.direction === 'in').classification).toBe('completed');
    await reply('em_refuse', mailsForRef(ctx, ita.shortRef)[0]!.replyTo as string, ita.shortRef, 'privacy@infoitalia.it', 'Non è possibile fornire i dati per obbligo di legge.');
    expect((await detail(ctx, s, ita.id)).status).toBe('refused');
    await api.put(`/requests/${acme.id}/findings`).send({ found: true, categories: ['contacts'] }).expect(200); // the user can correct it
  });

  it('can be switched off by the operator', async () => {
    process.env.FEATURES_DISABLED = 'access';
    const off = await createTestApp();
    try {
      const s = await register(off);
      const r = await activeProfile(off, s);
      const res = await authed(off, s).post('/requests/access').send({ profileId: r.id, brokerIds: ['acme-leads'] }).expect(404);
      expect(res.body.code).toBe('FEATURE_DISABLED');
      expect((await off.http().get('/api/v1/config').expect(200)).body.features.accessRequests).toBe(false);
    } finally {
      delete process.env.FEATURES_DISABLED;
      await off.close();
    }
  });
});
