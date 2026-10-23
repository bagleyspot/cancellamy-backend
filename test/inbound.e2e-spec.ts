import { Webhook } from 'standardwebhooks';
import { Types } from 'mongoose';
import { TestCtx, activeProfile, authed, createTestApp, detail, listRequests, register, requestByBroker, uniqueEmail, Session } from './helpers';

const SECRET = process.env.RESEND_WEBHOOK_SECRET as string;
const PDF_BYTES = Buffer.from('%PDF-1.4 confirmation');
let seq = 0;

function signed(body: unknown, opts: { id?: string; ageSeconds?: number } = {}) {
  const payload = JSON.stringify(body);
  const id = opts.id ?? `msg_${Date.now()}_${seq++}`;
  const when = new Date(Date.now() - (opts.ageSeconds ?? 0) * 1000);
  const signature = new Webhook(SECRET).sign(id, when, payload);
  return { payload, headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(Math.floor(when.getTime() / 1000)), 'svix-signature': signature } };
}

describe('inbound replies via the Resend webhook', () => {
  let ctx: TestCtx;
  let fetchMock: jest.SpyInstance;
  let received: Record<string, Record<string, unknown>>;
  let fetchStatus = 200;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    received = {};
    fetchStatus = 200;
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://files.example/')) return new Response(PDF_BYTES, { status: 200 });
      if (!url.startsWith('https://api.resend.com/emails/receiving/')) throw new Error(`unexpected fetch ${url}`);
      if (fetchStatus !== 200) return new Response('{}', { status: fetchStatus });
      const path = url.replace('https://api.resend.com/emails/receiving/', '').split('/');
      const id = decodeURIComponent(path[0] as string);
      if (path[1] === 'attachments') {
        const list = (received[id]?.attachments ?? []) as Array<{ filename: string; content_type: string; size: number }>;
        return new Response(
          JSON.stringify({ object: 'list', has_more: false, data: list.map((a, i) => ({ id: `att_${i}`, ...a, download_url: `https://files.example/${id}/${i}` })) }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(received[id] ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  });
  afterEach(() => fetchMock.mockRestore());

  async function sentUser(): Promise<{ s: Session; replyTo: string; acme: Record<string, any>; ita: Record<string, any> }> {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    const ita = await requestByBroker(ctx, s, 'infoitalia');
    const mail = ctx.mail.sent.find((m) => m.headers?.['X-Cancellamy-Ref'] === acme.shortRef)!;
    return { s, replyTo: mail.replyTo as string, acme, ita };
  }

  const post = (p: { payload: string; headers: Record<string, string> }) => {
    const req = ctx.http().post('/api/v1/webhooks/resend');
    for (const [k, v] of Object.entries(p.headers)) req.set(k, v);
    return req.send(p.payload);
  };
  const event = (emailId: string) => ({ type: 'email.received', created_at: new Date().toISOString(), data: { email_id: emailId } });

  it('applies a verified reply matched by reference code and ignores duplicate deliveries', async () => {
    const { s, replyTo, acme } = await sentUser();
    received['em_a1'] = {
      id: 'em_a1',
      from: 'Privacy <privacy@acmeleads.com>',
      to: [replyTo],
      subject: `Re: GDPR erasure and objection request - Mario Rossi [${acme.shortRef}]`,
      text: 'Hello, we have deleted your personal data from our systems.',
      created_at: new Date().toISOString(),
      attachments: [{ filename: 'conferma.pdf', content_type: 'application/pdf', size: PDF_BYTES.length }],
    };
    const delivery = signed(event('em_a1'));
    await post(delivery).expect(200, { received: true });
    const d = await detail(ctx, s, acme.id);
    expect(d.status).toBe('completed');
    const reply = d.messages.find((m: { direction: string }) => m.direction === 'in');
    expect(reply).toMatchObject({ classification: 'completed', dryRun: false, attachments: [{ filename: 'conferma.pdf', size: PDF_BYTES.length, downloadable: true }] });
    expect(reply.from).toContain('privacy@acmeleads.com');

    const calls = fetchMock.mock.calls.length;
    await post(delivery).expect(200); // identical redelivery
    expect(fetchMock.mock.calls.length).toBe(calls);
    await post(signed(event('em_a1'))).expect(200); // same email, new delivery id
    expect((await detail(ctx, s, acme.id)).messages.filter((m: { direction: string }) => m.direction === 'in')).toHaveLength(1);
  });

  it('rejects bad signatures, stale timestamps and missing configuration headers', async () => {
    const good = signed(event('em_x'));
    await post({ ...good, payload: good.payload.replace('em_x', 'em_y') }).expect(400);
    await post({ payload: good.payload, headers: { 'content-type': 'application/json' } }).expect(400);
    await post({ payload: good.payload, headers: { ...good.headers, 'svix-signature': 'v1,AAAA' } }).expect(400);
    await post(signed(event('em_x'), { ageSeconds: 600 })).expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores other event types without fetching anything', async () => {
    await post(signed({ type: 'email.delivered', data: { email_id: 'em_z' } })).expect(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('matches by sender domain when the reference code is missing', async () => {
    const { s, replyTo, ita } = await sentUser();
    received['em_b1'] = { id: 'em_b1', from: 'ufficio@mail.infoitalia.it', to: [`Cancellamy <${replyTo}>`], subject: 'La sua richiesta', text: 'Non è possibile accogliere la richiesta per obbligo di legge.', created_at: new Date().toISOString() };
    await post(signed(event('em_b1'))).expect(200);
    expect((await detail(ctx, s, ita.id)).status).toBe('refused');
  });

  it("does not mistake quoted text of our own request for the broker's answer", async () => {
    const { s, replyTo, acme } = await sentUser();
    received['em_c1'] = {
      id: 'em_c1',
      from: 'privacy@acmeleads.com',
      to: [replyTo],
      subject: `Re: [${acme.shortRef}]`,
      text: [
        'Thanks, we will look into it.',
        '',
        'On Mon, 5 Oct 2026 at 10:00, Cancellamy <richieste@example.org> wrote:',
        '> If you consider an identity document strictly necessary, say so in your reply.',
        '> verify your identity',
      ].join('\n'),
      created_at: new Date().toISOString(),
    };
    await post(signed(event('em_c1'))).expect(200);
    const d = await detail(ctx, s, acme.id);
    expect(d.status).toBe('replied');
    expect(d.messages.at(-1).classification).toBe('unknown');
  });

  it('moves a request to action_required when the broker asks for a document', async () => {
    const { s, replyTo, acme } = await sentUser();
    received['em_d1'] = { id: 'em_d1', from: 'privacy@acmeleads.com', to: [replyTo], subject: `Re: [${acme.shortRef}]`, text: 'Please verify your identity by sending a copy of your passport.', created_at: new Date().toISOString() };
    await post(signed(event('em_d1'))).expect(200);
    expect(await detail(ctx, s, acme.id)).toMatchObject({ status: 'action_required', actionReason: 'id_required', canProvideId: true });
  });

  it('keeps unmatched or failing-DMARC mail for an admin and lets the admin assign it', async () => {
    const { s, replyTo, acme } = await sentUser();
    received['em_e1'] = { id: 'em_e1', from: 'someone@else.example', to: ['r-unknowntoken@in.example.org'], subject: 'hello', text: 'who are you', created_at: new Date().toISOString() };
    received['em_e2'] = { id: 'em_e2', from: 'privacy@acmeleads.com', to: [replyTo], subject: `Re: [${acme.shortRef}]`, text: 'We have deleted your data.', created_at: new Date().toISOString(), authentication: { dmarc: { result: 'fail' } } };
    await post(signed(event('em_e1'))).expect(200);
    await post(signed(event('em_e2'))).expect(200);
    expect((await detail(ctx, s, acme.id)).status).toBe('sent');

    const admin = await register(ctx, 'admin@example.org');
    expect((await authed(ctx, admin).get('/me').expect(200)).body.role).toBe('admin');
    const list = (await authed(ctx, admin).get('/admin/inbound-unmatched').expect(200)).body as Array<{ id: string; subject: string; assignedRequestId: string | null }>;
    const spoofed = list.find((u) => u.subject.includes(acme.shortRef))!;
    expect(list.some((u) => u.subject === 'hello')).toBe(true);
    await authed(ctx, s).get('/admin/inbound-unmatched').expect(403);

    await authed(ctx, admin).post(`/admin/inbound-unmatched/${spoofed.id}/assign`).send({ requestId: acme.shortRef.toLowerCase() }).expect(204);
    expect((await detail(ctx, s, acme.id)).status).toBe('completed');
    await authed(ctx, admin).post(`/admin/inbound-unmatched/${spoofed.id}/assign`).send({ requestId: acme.id }).expect(400);
    await authed(ctx, admin).post(`/admin/inbound-unmatched/${new Types.ObjectId()}/assign`).send({ requestId: acme.id }).expect(404);
    const second = list.find((u) => u.subject === 'hello')!;
    await authed(ctx, admin).post(`/admin/inbound-unmatched/${second.id}/assign`).send({ requestId: 'garbage' }).expect(404);
    const stats = (await authed(ctx, admin).get('/admin/stats').expect(200)).body;
    expect(stats.unmatchedInbound).toBeGreaterThanOrEqual(1);
  });

  it('answers 503 when the provider is unavailable and lets the retry succeed', async () => {
    const { s, replyTo, acme } = await sentUser();
    received['em_f1'] = { id: 'em_f1', from: 'privacy@acmeleads.com', to: [replyTo], subject: `Re: [${acme.shortRef}]`, text: 'We have deleted your personal data.', created_at: new Date().toISOString() };
    const delivery = signed(event('em_f1'));
    fetchStatus = 500;
    await post(delivery).expect(503);
    expect((await detail(ctx, s, acme.id)).status).toBe('sent');
    fetchStatus = 200;
    await post(delivery).expect(200);
    expect((await detail(ctx, s, acme.id)).status).toBe('completed');
  });

  it('does not touch another user\'s requests even with a guessed reference', async () => {
    const a = await sentUser();
    const b = await sentUser();
    received['em_g1'] = { id: 'em_g1', from: 'privacy@acmeleads.com', to: [b.replyTo], subject: `Re: [${a.acme.shortRef}]`, text: 'We have deleted your personal data.', created_at: new Date().toISOString() };
    await post(signed(event('em_g1'))).expect(200);
    expect((await detail(ctx, a.s, a.acme.id)).status).toBe('sent');
    expect((await detail(ctx, b.s, b.acme.id)).status).toBe('completed'); // matched through B's own profile by sender domain
    expect(uniqueEmail()).toBeTruthy();
    expect((await listRequests(ctx, a.s)).total).toBe(4);
  });
});
