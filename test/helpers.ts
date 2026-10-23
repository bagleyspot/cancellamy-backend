import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Clock } from '../src/common/clock';
import { MAIL_TRANSPORT, MailError, MailMessage, MailTransport, SendResult } from '../src/mail/mail.types';
import { SchedulerService } from '../src/scheduler/scheduler.service';

export class CaptureTransport implements MailTransport {
  readonly dryRun = true;
  sent: MailMessage[] = [];
  failWith?: MailError;
  /** When true the provider answers as if the email was really delivered (affects the dryRun flag of requests). */
  real = false;
  private n = 0;

  async send(message: MailMessage): Promise<SendResult> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
    this.n += 1;
    return { id: `cap_${this.n}`, dryRun: !this.real };
  }

  to(address: string): MailMessage[] {
    return this.sent.filter((m) => m.to.includes(address));
  }
}

export interface TestCtx {
  app: INestApplication;
  mail: CaptureTransport;
  clock: Clock;
  scheduler: SchedulerService;
  connection: Connection;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestCtx> {
  const mail = new CaptureTransport();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  configureApp(app, { logger: false });
  await app.init();
  return {
    app,
    mail,
    clock: app.get(Clock),
    scheduler: app.get(SchedulerService),
    connection: app.get<Connection>(getConnectionToken()),
    http: () => request(app.getHttpServer()),
    close: async () => {
      await app.close();
    },
  };
}

export const PASSWORD = 'correct-horse-battery';

export interface Session {
  email: string;
  token: string;
  cookie: string;
  userId: string;
}

let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}${Date.now()}${counter++}@example.org`;

export function cookieFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const c = raw?.find((x) => x.startsWith('cnc_rt='));
  if (!c) throw new Error('no refresh cookie');
  return c.split(';')[0] as string;
}

export async function register(ctx: TestCtx, email = uniqueEmail(), verify = true): Promise<Session> {
  const res = await ctx.http().post('/api/v1/auth/register').send({ email, password: PASSWORD, acceptTerms: true }).expect(201);
  const session: Session = { email, token: res.body.accessToken, cookie: cookieFrom(res), userId: res.body.user.id };
  if (verify) await verifyEmail(ctx, session);
  return session;
}

export function tokenFromMail(ctx: TestCtx, to: string, marker: string): string {
  const mails = ctx.mail.to(to).filter((m) => m.text.includes(marker));
  const last = mails[mails.length - 1];
  const m = last && new RegExp(`${marker}\\?token=([\\w-]+)`).exec(last.text);
  if (!m) throw new Error(`no ${marker} mail for ${to}`);
  return m[1] as string;
}

export async function verifyEmail(ctx: TestCtx, s: Session): Promise<void> {
  await ctx.http().post('/api/v1/auth/verify-email').send({ token: tokenFromMail(ctx, s.email, 'verifica-email') }).expect(204);
}

export const authed = (ctx: TestCtx, s: Session) => ({
  get: (url: string) => ctx.http().get(`/api/v1${url}`).set('Authorization', `Bearer ${s.token}`),
  post: (url: string) => ctx.http().post(`/api/v1${url}`).set('Authorization', `Bearer ${s.token}`),
  patch: (url: string) => ctx.http().patch(`/api/v1${url}`).set('Authorization', `Bearer ${s.token}`),
  put: (url: string) => ctx.http().put(`/api/v1${url}`).set('Authorization', `Bearer ${s.token}`),
  del: (url: string) => ctx.http().delete(`/api/v1${url}`).set('Authorization', `Bearer ${s.token}`),
});

export const profileInput = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Mario',
  lastName: 'Rossi',
  dateOfBirth: '1985-03-12',
  emails: ['mario.rossi@example.it'],
  phones: ['+39 333 1234567'],
  addresses: [{ street: 'Via Roma 1', city: 'Milano', zip: '20100', province: 'MI', country: 'IT' }],
  fiscalCode: 'RSSMRA85C12F205Z',
  aliases: ['Mario Rosi'],
  ...overrides,
});

/** Creates a profile, signs the delega and activates it. */
export async function activeProfile(ctx: TestCtx, s: Session, overrides: Record<string, unknown> = {}) {
  const api = authed(ctx, s);
  const created = await api.post('/profiles').send(profileInput(overrides)).expect(201);
  const id = created.body.id as string;
  await api.post(`/profiles/${id}/authorization`).send({ signatureName: `${created.body.firstName} ${created.body.lastName}`, accepted: true }).expect(201);
  const act = await api.post(`/profiles/${id}/activate`).expect(200);
  return { id, activation: act.body as { emailRequests: number; manualActions: number } };
}

export async function listRequests(ctx: TestCtx, s: Session, query = ''): Promise<{ items: Array<Record<string, any>>; total: number }> {
  const res = await authed(ctx, s).get(`/requests?limit=100${query ? `&${query}` : ''}`).expect(200);
  return res.body;
}

export const DAY = 24 * 60 * 60 * 1000;

export async function requestByBroker(ctx: TestCtx, s: Session, brokerId: string, cycle = 1): Promise<Record<string, any>> {
  const { items } = await listRequests(ctx, s);
  const r = items.find((x) => x.broker.id === brokerId && x.cycle === cycle);
  if (!r) throw new Error(`no request for ${brokerId} cycle ${cycle}`);
  return r;
}

export async function detail(ctx: TestCtx, s: Session, id: string): Promise<Record<string, any>> {
  return (await authed(ctx, s).get(`/requests/${id}`).expect(200)).body;
}

export function mailsForRef(ctx: TestCtx, shortRef: string) {
  return ctx.mail.sent.filter((m) => m.headers?.['X-Cancellamy-Ref'] === shortRef);
}

/** supertest parser that keeps the response as a Buffer (PDF, ZIP, attachments). */
export const binaryParser = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
