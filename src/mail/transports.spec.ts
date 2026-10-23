import { DryRunTransport, ResendTransport } from './transports';
import { MailError } from './mail.types';

const send = jest.fn();
jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send } })) }));

const msg = { from: 'a@x.it', to: ['b@y.it'], subject: 's', text: 't', idempotencyKey: 'k1' };

describe('transports', () => {
  beforeEach(() => send.mockReset());

  it('dry-run returns a synthetic id and never calls a provider', async () => {
    const r = await new DryRunTransport().send(msg);
    expect(r.dryRun).toBe(true);
    expect(r.id).toMatch(/^dry_/);
  });

  it('resend: passes idempotency key, attachments and reply-to', async () => {
    send.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    const r = await new ResendTransport('re_x').send({
      ...msg,
      replyTo: 'r-abc@in.x.it',
      attachments: [{ filename: 'delega.pdf', content: Buffer.from('x'), contentType: 'application/pdf' }],
    });
    expect(r).toEqual({ id: 'em_1', dryRun: false });
    const [payload, options] = send.mock.calls[0];
    expect(payload.replyTo).toBe('r-abc@in.x.it');
    expect(payload.attachments[0].filename).toBe('delega.pdf');
    expect(options).toEqual({ idempotencyKey: 'k1' });
  });

  it('resend: classifies 429/5xx as transient and 4xx as permanent', async () => {
    send.mockResolvedValueOnce({ data: null, error: { name: 'rate_limit_exceeded', message: 'slow down', statusCode: 429 } });
    await expect(new ResendTransport('k').send(msg)).rejects.toMatchObject({ transient: true });
    send.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'bad', statusCode: 422 } });
    await expect(new ResendTransport('k').send(msg)).rejects.toMatchObject({ transient: false });
    send.mockResolvedValueOnce({ data: null, error: { name: 'application_error', message: 'oops', statusCode: 500 } });
    await expect(new ResendTransport('k').send(msg)).rejects.toBeInstanceOf(MailError);
  });

  it('resend: network failures are transient', async () => {
    send.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(new ResendTransport('k').send(msg)).rejects.toMatchObject({ transient: true });
  });
});
