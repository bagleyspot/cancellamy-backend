import { SMTPServer } from 'smtp-server';
import { AddressInfo } from 'net';
import { TestCtx, activeProfile, authed, createTestApp, detail, listRequests, profileInput, register } from './helpers';

function startSmtp(messages: string[]): Promise<{ server: SMTPServer; port: number }> {
  const server = new SMTPServer({
    authOptional: false,
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    logger: false,
    onAuth(auth, _session, cb) {
      if (auth.username === 'mario@example.it' && auth.password === 'app-password-1') cb(null, { user: 'mario' });
      else cb(new Error('Invalid login'));
    },
    onData(stream, _session, cb) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        messages.push(Buffer.concat(chunks).toString('utf8'));
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

async function withManualSelection(run: (ctx: TestCtx, port: number, sent: string[]) => Promise<void>, env: Record<string, string> = {}) {
  const sent: string[] = [];
  const { server, port } = await startSmtp(sent);
  const saved: Record<string, string | undefined> = { SEND_SELECTION: process.env.SEND_SELECTION };
  delete process.env.SEND_SELECTION; // manual is the default in mailbox mode
  for (const [k, v] of Object.entries({ MAIL_MODE: 'mailbox', USER_DAILY_REQUEST_LIMIT: '1', ...env })) {
    if (!(k in saved)) saved[k] = process.env[k];
    process.env[k] = v;
  }
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

/** A user with its own mailbox connected and an activated profile: the requests are drafts. */
async function userWithDrafts(ctx: TestCtx, port: number) {
  const s = await register(ctx);
  const api = authed(ctx, s);
  const id = (await api.post('/profiles').send(profileInput({ emails: ['mario@example.it'] })).expect(201)).body.id as string;
  await api.put(`/profiles/${id}/sender`).send(smtpBody(port)).expect(200);
  await api.post(`/profiles/${id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
  const activation = (await api.post(`/profiles/${id}/activate`).expect(200)).body;
  return { s, api, id, activation };
}

describe('manual selection: the user chooses which requests are sent', () => {
  it('advertises the mode and the limit of 10 per call', async () => {
    await withManualSelection(async (ctx) => {
      expect((await ctx.http().get('/api/v1/config').expect(200)).body).toMatchObject({ sendSelection: 'manual', sendSelectionMax: 10 });
    });
  });

  it('creates the email requests as drafts at activation: nothing is queued or sent, not even by the scheduler', async () => {
    await withManualSelection(async (ctx, port, sent) => {
      const { s, api, activation } = await userWithDrafts(ctx, port);
      expect(activation.awaitingSelection).toBe(true);

      await ctx.scheduler.tick();
      await ctx.scheduler.tick();
      expect(sent).toHaveLength(0);

      const all = (await listRequests(ctx, s)).items;
      const emailRequests = all.filter((r) => r.channel === 'email');
      expect(emailRequests.length).toBeGreaterThanOrEqual(2);
      expect(emailRequests.every((r) => r.status === 'draft')).toBe(true);
      expect(all.filter((r) => r.channel !== 'email').every((r) => r.status === 'action_required')).toBe(true); // manual actions are unchanged
      expect((await api.get('/requests?group=to_send').expect(200)).body.total).toBe(emailRequests.length);
      expect((await api.get('/requests/summary').expect(200)).body.counts).toMatchObject({ toSend: emailRequests.length, inProgress: 0 });
    });
  });

  it('sends only the chosen drafts, right away and above the daily cap, and reports what it skipped', async () => {
    await withManualSelection(async (ctx, port, sent) => {
      const { s, api } = await userWithDrafts(ctx, port);
      const drafts = (await listRequests(ctx, s, 'group=to_send')).items;
      expect(drafts.length).toBeGreaterThanOrEqual(2);
      const chosen = drafts.slice(0, 2); // USER_DAILY_REQUEST_LIMIT is 1: the cap does not apply to what the user chooses

      const res = (await api.post('/requests/send').send({ requestIds: chosen.map((r) => r.id) }).expect(200)).body;
      expect(res).toEqual({ queued: 2, skipped: [] });
      await ctx.scheduler.tick();

      expect(sent).toHaveLength(2);
      for (const r of chosen) expect((await detail(ctx, s, r.id)).status).toBe('sent');
      const left = (await listRequests(ctx, s, 'group=to_send')).items;
      expect(left).toHaveLength(drafts.length - 2);
      expect(left.every((r) => r.status === 'draft')).toBe(true);

      // Choosing the same drafts again, a stranger's draft and an unknown id: nothing is sent twice
      const other = await register(ctx);
      const again = (await authed(ctx, other).post('/requests/send').send({ requestIds: [chosen[0]!.id] }).expect(200)).body;
      expect(again).toEqual({ queued: 0, skipped: [{ id: chosen[0]!.id, reason: 'not_found' }] });
      const repeat = (await api.post('/requests/send').send({ requestIds: [chosen[0]!.id, '0'.repeat(24)] }).expect(200)).body;
      expect(repeat).toEqual({ queued: 0, skipped: [{ id: chosen[0]!.id, reason: 'not_draft' }, { id: '0'.repeat(24), reason: 'not_found' }] });
      await ctx.scheduler.tick();
      expect(sent).toHaveLength(2);
    });
  });

  it('accepts at most 10 drafts per call, at least 1, no duplicates and only valid ids', async () => {
    await withManualSelection(async (ctx, port) => {
      const { api } = await userWithDrafts(ctx, port);
      const ids = Array.from({ length: 11 }, (_, i) => i.toString(16).padStart(24, '0'));
      expect((await api.post('/requests/send').send({ requestIds: ids })).status).toBe(400);
      expect((await api.post('/requests/send').send({ requestIds: ids.slice(0, 10) })).status).toBe(200);
      expect((await api.post('/requests/send').send({ requestIds: [] })).status).toBe(400);
      expect((await api.post('/requests/send').send({ requestIds: [ids[0], ids[0]] })).status).toBe(400);
      expect((await api.post('/requests/send').send({ requestIds: ['nope'] })).status).toBe(400);
      expect((await api.post('/requests/send').send({ requestIds: [{ $ne: null }] })).status).toBe(400);
      expect((await ctx.http().post('/api/v1/requests/send').send({ requestIds: ids.slice(0, 1) })).status).toBe(401);
    });
  });

  it('lets the user cancel a draft instead of sending it', async () => {
    await withManualSelection(async (ctx, port) => {
      const { s, api } = await userWithDrafts(ctx, port);
      const [first] = (await listRequests(ctx, s, 'group=to_send')).items;
      await api.post(`/requests/${first!.id}/cancel`).expect(200);
      expect((await detail(ctx, s, first!.id)).status).toBe('cancelled');
      expect((await api.post('/requests/send').send({ requestIds: [first!.id] }).expect(200)).body.skipped).toEqual([{ id: first!.id, reason: 'not_draft' }]);
    });
  });

  it('keeps the previous behaviour when SEND_SELECTION=auto: requests are queued and sent by the scheduler', async () => {
    await withManualSelection(async (ctx, port, sent) => {
      const s = await register(ctx);
      const api = authed(ctx, s);
      const id = (await api.post('/profiles').send(profileInput({ emails: ['mario@example.it'] })).expect(201)).body.id as string;
      await api.put(`/profiles/${id}/sender`).send(smtpBody(port)).expect(200);
      await api.post(`/profiles/${id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
      const act = (await api.post(`/profiles/${id}/activate`).expect(200)).body;
      expect(act.awaitingSelection).toBe(false);
      expect((await listRequests(ctx, s)).items.some((r) => r.status === 'queued')).toBe(true);
      await ctx.scheduler.tick();
      expect(sent.length).toBeGreaterThan(0);
    }, { SEND_SELECTION: 'auto' });
  });
});

describe('without own mailbox and outside mailbox mode nothing changes', () => {
  it('dry-run keeps queueing requests automatically', async () => {
    const ctx = await createTestApp();
    try {
      const s = await register(ctx);
      await activeProfile(ctx, s);
      const items = (await listRequests(ctx, s)).items;
      expect(items.some((r) => r.status === 'queued')).toBe(true);
      expect(items.some((r) => r.status === 'draft')).toBe(false);
    } finally {
      await ctx.close();
    }
  });
});
