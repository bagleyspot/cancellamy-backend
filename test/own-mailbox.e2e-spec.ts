import { SMTPServer } from 'smtp-server';
import { AddressInfo } from 'net';
import { DAY, TestCtx, authed, createTestApp, detail, mailsForRef, profileInput, register, requestByBroker } from './helpers';

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

async function withEnv(env: Record<string, string>, run: (ctx: TestCtx, port: number, sent: string[]) => Promise<void>) {
  const sent: string[] = [];
  const { server, port } = await startSmtp(sent);
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
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

/** The SMTP server receives quoted-printable MIME: undo the soft line breaks and the =XX escapes to read the text. */
function readable(raw: string): string {
  const joined = raw.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i += 1) {
    const hex = joined.slice(i + 1, i + 3);
    if (joined[i] === '=' && /^[0-9A-F]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else bytes.push(...Buffer.from(joined[i] as string, 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

const newProfile = async (ctx: TestCtx, s: Awaited<ReturnType<typeof register>>) =>
  (await authed(ctx, s).post('/profiles').send(profileInput({ emails: ['mario@example.it'] })).expect(201)).body as { id: string; status: string; authorizationRequired: boolean };

describe('writing from the own mailbox: the user is the data subject, no delega', () => {
  it('mailbox mode: the profile is ready without signing and its emails are in the first person, without mandate or attachment', async () => {
    await withEnv({ MAIL_MODE: 'mailbox', SEND_SELECTION: 'auto', OPERATOR_NAME: 'Studio Operatore' }, async (ctx, port, sent) => {
      const s = await register(ctx);
      const api = authed(ctx, s);
      const profile = await newProfile(ctx, s);
      expect(profile).toMatchObject({ status: 'ready', authorizationRequired: false });
      await api.put(`/profiles/${profile.id}/sender`).send(smtpBody(port)).expect(200);
      await api.post(`/profiles/${profile.id}/activate`).expect(200); // no delega was ever signed
      const acme = await requestByBroker(ctx, s, 'acme-leads');
      const ita = await requestByBroker(ctx, s, 'infoitalia');
      await ctx.scheduler.tick();

      const rawIt = sent.find((m) => m.includes(ita.shortRef)) as string;
      const it = readable(rawIt);
      expect(it).toMatch(/^Subject: Istanza di cancellazione/m);
      expect(it).toContain('Io sottoscritto/a Mario Rossi, in qualità di interessato, esercito personalmente');
      expect(it).toContain('Vi scrivo da questo mio indirizzo email');
      expect(it).toContain('Distinti saluti');
      expect(it).not.toMatch(/mandato|per delega|Studio Operatore|l'Interessato/i);
      expect(rawIt).not.toContain('delega.pdf');
      expect(rawIt).not.toMatch(/Content-Disposition: attachment/i);

      const en = readable(sent.find((m) => m.includes(acme.shortRef)) as string);
      expect(en).toContain('I, Mario Rossi, am the data subject and I am exercising my rights');
      expect(en).not.toMatch(/on behalf of|Studio Operatore|authori[sz]ation signed/i);
      expect((await detail(ctx, s, ita.id)).messages[0]).toMatchObject({ direction: 'out', via: 'smtp', attachments: [] });
    });
  });

  it('reminders keep the first person and need no delega either', async () => {
    await withEnv({ MAIL_MODE: 'mailbox', SEND_SELECTION: 'auto' }, async (ctx, port, sent) => {
      const s = await register(ctx);
      const api = authed(ctx, s);
      const profile = await newProfile(ctx, s);
      await api.put(`/profiles/${profile.id}/sender`).send(smtpBody(port)).expect(200);
      await api.post(`/profiles/${profile.id}/activate`).expect(200);
      const ita = await requestByBroker(ctx, s, 'infoitalia');
      await ctx.scheduler.tick();
      ctx.clock.advance(31 * DAY);
      await ctx.scheduler.tick(); // overdue + automatic reminder

      const reminder = readable(sent.filter((m) => m.includes(ita.shortRef)).find((m) => /Sollecito n\. 1/.test(m)) as string);
      expect(reminder).toContain('faccio seguito alla mia istanza');
      expect(reminder).toContain('presenterò, senza ulteriore avviso, reclamo al Garante');
      expect(reminder).not.toMatch(/delega|mandato|in nome e per conto/i);
    });
  });

  it('outside mailbox mode: connecting a mailbox makes a profile that waits for the delega ready, and its emails are first person', async () => {
    await withEnv({ MAIL_MODE: 'resend', SEND_SELECTION: 'auto' }, async (ctx, port, sent) => {
      const s = await register(ctx);
      const api = authed(ctx, s);
      const profile = await newProfile(ctx, s);
      expect(profile).toMatchObject({ status: 'draft', authorizationRequired: true });
      await api.post(`/profiles/${profile.id}/activate`).expect(409); // Cancellamy would write on the user's behalf: the delega is needed

      await api.put(`/profiles/${profile.id}/sender`).send(smtpBody(port)).expect(200);
      expect((await api.get(`/profiles/${profile.id}`).expect(200)).body).toMatchObject({ status: 'ready', authorizationRequired: false });
      await api.post(`/profiles/${profile.id}/activate`).expect(200);
      const ita = await requestByBroker(ctx, s, 'infoitalia');
      await ctx.scheduler.tick();
      expect(readable(sent.find((m) => m.includes(ita.shortRef)) as string)).toContain('esercito personalmente');
      expect(mailsForRef(ctx, ita.shortRef)).toHaveLength(0); // not through Cancellamy's provider
    });
  });

  it('a profile that Cancellamy writes for still signs the delega and gets the mandate wording', async () => {
    await withEnv({ MAIL_MODE: 'dry-run', SEND_SELECTION: 'auto', OPERATOR_NAME: 'Studio Operatore' }, async (ctx) => {
      const s = await register(ctx);
      const api = authed(ctx, s);
      const profile = await newProfile(ctx, s);
      expect(profile).toMatchObject({ status: 'draft', authorizationRequired: true });
      await api.post(`/profiles/${profile.id}/authorization`).send({ signatureName: 'Mario Rossi', accepted: true }).expect(201);
      await api.post(`/profiles/${profile.id}/activate`).expect(200);
      const ita = await requestByBroker(ctx, s, 'infoitalia');
      await ctx.scheduler.tick();
      const mail = mailsForRef(ctx, ita.shortRef)[0]!;
      expect(mail.text).toContain('ha conferito formale mandato con rappresentanza a Studio Operatore');
      expect(mail.attachments?.[0]?.filename).toBe('delega.pdf');
    });
  });

  it('going back to Cancellamy needs the delega: refused when active, back to draft when only ready', async () => {
    await withEnv({ MAIL_MODE: 'resend', SEND_SELECTION: 'auto' }, async (ctx, port) => {
      const s = await register(ctx);
      const api = authed(ctx, s);
      const waiting = await newProfile(ctx, s);
      await api.put(`/profiles/${waiting.id}/sender`).send(smtpBody(port)).expect(200);
      expect((await api.get(`/profiles/${waiting.id}`).expect(200)).body.status).toBe('ready');
      const back = await api.del(`/profiles/${waiting.id}/sender`).expect(200);
      expect(back.body.mode).toBe('cancellamy');
      expect((await api.get(`/profiles/${waiting.id}`).expect(200)).body).toMatchObject({ status: 'draft', authorizationRequired: true });

      const active = (await api.post('/profiles').send(profileInput({ emails: ['mario@example.it'], firstName: 'Luigi' })).expect(201)).body.id as string;
      await api.put(`/profiles/${active}/sender`).send(smtpBody(port)).expect(200);
      await api.post(`/profiles/${active}/activate`).expect(200);
      const refused = await api.del(`/profiles/${active}/sender`).expect(400);
      expect(refused.body.code).toBe('AUTHORIZATION_REQUIRED');
      expect((await api.get(`/profiles/${active}/sender`).expect(200)).body.mode).toBe('smtp');
    });
  });
});
