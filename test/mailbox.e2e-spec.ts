import { SMTPServer } from 'smtp-server';
import { AddressInfo } from 'net';
import { TestCtx, authed, createTestApp, detail, mailsForRef, profileInput, register, requestByBroker } from './helpers';

interface Received {
  raw: string;
  to: string[];
}

function startSmtp(messages: Received[]): Promise<{ server: SMTPServer; port: number }> {
  const server = new SMTPServer({
    authOptional: false,
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    logger: false,
    onAuth(auth, _session, cb) {
      if (auth.username === 'mario@example.it' && auth.password === 'app-password-1') cb(null, { user: 'mario' });
      else cb(new Error('Invalid login'));
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        messages.push({ raw: Buffer.concat(chunks).toString('utf8'), to: session.envelope.rcptTo.map((r) => r.address) });
        cb();
      });
    },
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.server.address() as AddressInfo).port })));
}

const smtpBody = (port: number) => ({
  mode: 'smtp',
  smtp: { host: '127.0.0.1', port, secure: false, username: 'mario@example.it', password: 'app-password-1', fromAddress: 'mario@example.it' },
});

/** Runs `run` against an app started in mailbox mode (optionally with the test redirect) and a real SMTP server. */
async function inMailboxMode(redirect: string | undefined, run: (ctx: TestCtx, port: number, sent: Received[]) => Promise<void>) {
  const sent: Received[] = [];
  const { server, port } = await startSmtp(sent);
  const saved = { MAIL_MODE: process.env.MAIL_MODE, MAIL_REDIRECT_TO: process.env.MAIL_REDIRECT_TO };
  process.env.MAIL_MODE = 'mailbox';
  if (redirect) process.env.MAIL_REDIRECT_TO = redirect;
  else delete process.env.MAIL_REDIRECT_TO;
  const ctx = await createTestApp();
  try {
    await run(ctx, port, sent);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await ctx.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function activate(ctx: TestCtx, s: Awaited<ReturnType<typeof register>>, id: string) {
  const api = authed(ctx, s);
  await api.post(`/profiles/${id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
  await api.post(`/profiles/${id}/activate`).expect(200);
}

describe('mailbox mode: run locally without Resend, sending from the user mailbox', () => {
  it('advertises the mode, and does not need Resend or an inbound domain', async () => {
    await inMailboxMode(undefined, async (ctx) => {
      const config = (await ctx.http().get('/api/v1/config').expect(200)).body;
      expect(config).toMatchObject({ mailMode: 'mailbox', mailRedirect: false });
    });
  });

  it('keeps the requests waiting, and tells the user, until a mailbox is connected', async () => {
    await inMailboxMode(undefined, async (ctx, port, sent) => {
      const s = await register(ctx);
      const api = authed(ctx, s);
      const id = (await api.post('/profiles').send(profileInput({ emails: ['mario@example.it'] })).expect(201)).body.id as string;
      await activate(ctx, s, id);
      const acme = await requestByBroker(ctx, s, 'acme-leads');

      await ctx.scheduler.tick();
      expect(sent).toHaveLength(0);
      expect(mailsForRef(ctx, acme.shortRef)).toHaveLength(0); // nothing "from Cancellamy" either
      expect((await detail(ctx, s, acme.id)).status).toBe('queued');
      expect((await api.get(`/profiles/${id}/sender`).expect(200)).body.lastError).toMatch(/only sends from your own mailbox/);

      await api.put(`/profiles/${id}/sender`).send(smtpBody(port)).expect(200);
      await ctx.scheduler.tick();
      expect((await detail(ctx, s, acme.id)).status).toBe('sent');
      expect(sent.some((m) => m.raw.includes(acme.shortRef))).toBe(true);
    });
  });

  it('sends to the broker from the user address, with replies going to the user (no Cancellamy alias)', async () => {
    await inMailboxMode(undefined, async (ctx, port, sent) => {
      const s = await register(ctx);
      const api = authed(ctx, s);
      const id = (await api.post('/profiles').send(profileInput({ emails: ['mario@example.it'] })).expect(201)).body.id as string;
      await api.put(`/profiles/${id}/sender`).send(smtpBody(port)).expect(200);
      await activate(ctx, s, id);
      const acme = await requestByBroker(ctx, s, 'acme-leads');
      await ctx.scheduler.tick();

      const mine = sent.filter((m) => m.raw.includes(acme.shortRef));
      expect(mine).toHaveLength(1);
      expect(mine[0]!.to).toEqual(['privacy@acmeleads.com']);
      expect(mine[0]!.raw).toMatch(/^From: "?Mario Rossi"? <mario@example\.it>/mi);
      expect(mine[0]!.raw).not.toMatch(/^Reply-To:/mi);
      expect(mine[0]!.raw).not.toMatch(/in\.example\.org/);
      expect(mine[0]!.raw).toMatch(/^X-Cancellamy-Ref: CNC-/m);
      expect(mailsForRef(ctx, acme.shortRef)).toHaveLength(0); // the Resend transport is never used
      expect((await detail(ctx, s, acme.id)).messages[0]).toMatchObject({ direction: 'out', via: 'smtp', dryRun: false });
      expect((await api.get(`/profiles/${id}/sender`).expect(200)).body.replyAddress).toBe('mario@example.it');
    });
  });

  it('with MAIL_REDIRECT_TO the email goes to the test address and not to the broker', async () => {
    await inMailboxMode('prova@example.org', async (ctx, port, sent) => {
      expect((await ctx.http().get('/api/v1/config').expect(200)).body).toMatchObject({ mailMode: 'mailbox', mailRedirect: true });
      const s = await register(ctx);
      const api = authed(ctx, s);
      const id = (await api.post('/profiles').send(profileInput({ emails: ['mario@example.it'] })).expect(201)).body.id as string;
      await api.put(`/profiles/${id}/sender`).send(smtpBody(port)).expect(200);
      await activate(ctx, s, id);
      const acme = await requestByBroker(ctx, s, 'acme-leads');
      await ctx.scheduler.tick();

      const mine = sent.filter((m) => m.raw.includes(acme.shortRef));
      expect(mine).toHaveLength(1);
      expect(mine[0]!.to).toEqual(['prova@example.org']);
      expect(mine[0]!.raw).toMatch(/^To: prova@example\.org/mi);
      expect(mine[0]!.raw).toMatch(/^Subject: \[TEST -> privacy@acmeleads\.com\]/mi);
      expect(mine[0]!.raw).toMatch(/^X-Original-To: privacy@acmeleads\.com/mi);
      expect(sent.some((m) => m.to.includes('privacy@acmeleads.com'))).toBe(false);
      expect((await detail(ctx, s, acme.id)).status).toBe('sent'); // the flow runs as for a real send
    });
  });
});
