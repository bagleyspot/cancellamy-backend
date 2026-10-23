import { createHash } from 'crypto';
import { unzipSync } from 'fflate';
import { TestCtx, activeProfile, authed, binaryParser, createTestApp, register, requestByBroker } from './helpers';

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const text = (b: Uint8Array) => Buffer.from(b).toString('utf8');

function download(ctx: TestCtx, s: Awaited<ReturnType<typeof register>>, id: string, query = '') {
  return authed(ctx, s).get(`/requests/${id}/dossier.zip${query}`).buffer(true).parse(binaryParser);
}

describe('evidence dossier', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('bundles delega, messages and timeline with verifiable SHA-256 hashes', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    const acme = await requestByBroker(ctx, s, 'acme-leads');
    await authed(ctx, s).post(`/requests/${acme.id}/simulate-reply`).send({ kind: 'completed' }).expect(200);

    const res = await download(ctx, s, acme.id).expect(200);
    expect(res.headers['content-type']).toMatch(/application\/zip/);
    expect(res.headers['content-disposition']).toContain(`dossier-${acme.shortRef}.zip`);
    const files = unzipSync(new Uint8Array(res.body as Buffer));
    const names = Object.keys(files);
    for (const required of ['00-copertina.pdf', '01-delega.pdf', 'LEGGIMI.txt', 'cronologia.json', 'manifest.json', 'manifest.sha256', 'messaggi/messaggi.json']) {
      expect(names).toContain(required);
    }
    expect(names.filter((n) => n.startsWith('messaggi/') && n.endsWith('.txt'))).toHaveLength(2);
    expect(names).not.toContain('manifest.tsr');
    expect(text(files['00-copertina.pdf'] as Uint8Array).startsWith('%PDF-')).toBe(true);
    expect(text(files['01-delega.pdf'] as Uint8Array).startsWith('%PDF-')).toBe(true);

    // Every file is listed with the right hash and size; the manifest itself is covered by manifest.sha256.
    const manifest = JSON.parse(text(files['manifest.json'] as Uint8Array));
    expect(manifest).toMatchObject({ version: 1, hashAlgorithm: 'SHA-256', request: { shortRef: acme.shortRef, broker: 'Acme Leads Inc.' } });
    const listed = new Set<string>();
    for (const f of manifest.files as Array<{ path: string; sha256: string; bytes: number }>) {
      listed.add(f.path);
      expect(sha(files[f.path] as Uint8Array)).toBe(f.sha256);
      expect((files[f.path] as Uint8Array).length).toBe(f.bytes);
    }
    expect([...listed].sort()).toEqual(names.filter((n) => !n.startsWith('manifest.')).sort());
    expect(text(files['manifest.sha256'] as Uint8Array)).toBe(`${sha(files['manifest.json'] as Uint8Array)}  manifest.json\n`);

    const sent = names.find((n) => n.includes('-inviato-')) as string;
    const received = names.find((n) => n.includes('-ricevuto-')) as string;
    expect(text(files[sent] as Uint8Array)).toContain(`[${acme.shortRef}]`);
    expect(text(files[sent] as Uint8Array)).toContain('Metodo: dry-run');
    expect(text(files[received] as Uint8Array)).toContain('Classificazione automatica: completed');
    const messages = JSON.parse(text(files['messaggi/messaggi.json'] as Uint8Array));
    expect(messages).toHaveLength(2);
    expect(messages[1].textSha256).toHaveLength(64);
    const timeline = JSON.parse(text(files['cronologia.json'] as Uint8Array));
    expect(timeline.map((t: { type: string }) => t.type)).toEqual(expect.arrayContaining(['created', 'sent', 'reply_received']));
    expect(text(files['LEGGIMI.txt'] as Uint8Array)).toContain('shasum -a 256 -c manifest.sha256');
  });

  it('includes manual requests without messages and keeps working after the delega is revoked', async () => {
    const s = await register(ctx);
    const { id } = await activeProfile(ctx, s);
    const form = await requestByBroker(ctx, s, 'form-only');
    await authed(ctx, s).del(`/profiles/${id}/authorization`).expect(204);
    const files = unzipSync(new Uint8Array((await download(ctx, s, form.id).expect(200)).body as Buffer));
    expect(Object.keys(files).some((n) => n.startsWith('messaggi/') && n.endsWith('.txt'))).toBe(false);
    expect(JSON.parse(text(files['messaggi/messaggi.json'] as Uint8Array))).toEqual([]);
    expect(Object.keys(files)).toContain('01-delega.pdf'); // the signed text is still the evidence of what was authorised
  });

  it("protects other users' requests and bad input", async () => {
    const a = await register(ctx);
    const b = await register(ctx);
    await activeProfile(ctx, a);
    const r = await requestByBroker(ctx, a, 'rpo');
    await download(ctx, b, r.id).expect(404);
    await ctx.http().get(`/api/v1/requests/${r.id}/dossier.zip`).expect(401);
    await download(ctx, a, 'bad-id').expect(400);
  });

  it('refuses a timestamp when no authority is configured', async () => {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    const r = await requestByBroker(ctx, s, 'rpo');
    const res = await authed(ctx, s).get(`/requests/${r.id}/dossier.zip?timestamp=true`).expect(400);
    expect(res.body.code).toBe('FEATURE_DISABLED');
    expect((await ctx.http().get('/api/v1/config').expect(200)).body.features.dossierTimestamp).toBe(false);
  });

  it('can be switched off by the operator', async () => {
    process.env.FEATURES_DISABLED = 'dossier';
    const off = await createTestApp();
    try {
      const s = await register(off);
      await activeProfile(off, s);
      const r = await requestByBroker(off, s, 'rpo');
      expect((await authed(off, s).get(`/requests/${r.id}/dossier.zip`).expect(404)).body.code).toBe('FEATURE_DISABLED');
    } finally {
      delete process.env.FEATURES_DISABLED;
      await off.close();
    }
  });
});

describe('dossier timestamp (RFC 3161)', () => {
  let ctx: TestCtx;
  let fetchMock: jest.SpyInstance;
  let tsaReply: Buffer | null;
  let tsaStatus = 200;
  let lastBody: Buffer | undefined;

  beforeAll(async () => {
    process.env.TSA_URL = 'https://tsa.example/tsr';
    ctx = await createTestApp();
  });
  afterAll(async () => {
    delete process.env.TSA_URL;
    await ctx.close();
  });
  beforeEach(() => {
    tsaReply = Buffer.from('3005300302010 0'.replace(' ', ''), 'hex'); // PKIStatus granted
    tsaStatus = 200;
    lastBody = undefined;
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) !== 'https://tsa.example/tsr') throw new Error(`unexpected fetch ${String(input)}`);
      lastBody = Buffer.from(init?.body as Uint8Array);
      expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/timestamp-query');
      return new Response(tsaReply ? new Uint8Array(tsaReply) : null, { status: tsaStatus });
    });
  });
  afterEach(() => fetchMock.mockRestore());

  async function setup() {
    const s = await register(ctx);
    await activeProfile(ctx, s);
    await ctx.scheduler.tick();
    return { s, req: await requestByBroker(ctx, s, 'acme-leads') };
  }

  it('adds manifest.tsr and sends only the manifest hash to the authority', async () => {
    expect((await ctx.http().get('/api/v1/config').expect(200)).body.features.dossierTimestamp).toBe(true);
    const { s, req } = await setup();
    const res = await download(ctx, s, req.id, '?timestamp=true').expect(200);
    const files = unzipSync(new Uint8Array(res.body as Buffer));
    expect(Buffer.from(files['manifest.tsr'] as Uint8Array).equals(tsaReply as Buffer)).toBe(true);
    const manifestHash = sha(files['manifest.json'] as Uint8Array);
    expect(lastBody?.includes(Buffer.from(manifestHash, 'hex'))).toBe(true);
    // No personal data in the query: the request is just a DER structure around the digest.
    expect(lastBody?.toString('utf8')).not.toContain('Mario');
    const without = unzipSync(new Uint8Array((await download(ctx, s, req.id).expect(200)).body as Buffer));
    expect(Object.keys(without)).not.toContain('manifest.tsr');
  });

  it('answers 502 when the authority fails or refuses', async () => {
    const { s, req } = await setup();
    tsaStatus = 500;
    expect((await authed(ctx, s).get(`/requests/${req.id}/dossier.zip?timestamp=true`).expect(502)).body.code).toBe('TIMESTAMP_UNAVAILABLE');
    tsaStatus = 200;
    tsaReply = Buffer.from('300530030201 02'.replace(' ', ''), 'hex'); // rejection
    expect((await authed(ctx, s).get(`/requests/${req.id}/dossier.zip?timestamp=true`).expect(502)).body.code).toBe('TIMESTAMP_UNAVAILABLE');
  });
});
