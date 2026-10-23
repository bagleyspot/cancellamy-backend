import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Session, SessionDoc, User, UserDoc } from '../db/schemas';
import { Clock, DAY_MS } from '../common/clock';
import { randomToken, sha256 } from '../common/crypto.service';
import { badRequest, conflict, unauthorized } from '../common/errors';
import { MailService } from '../mail/mail.service';
import { UserDto, toUserDto } from '../users/users.service';
import { JwtPayload } from './auth.types';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 30 * DAY_MS;
const VERIFY_TTL_MS = 2 * DAY_MS;
const RESET_TTL_MS = 60 * 60 * 1000;
const LOCK_AFTER_FAILURES = 10;
const LOCK_MS = 15 * 60 * 1000;
/** A refresh token reused within this window is a benign race (two tabs), not theft. */
const REFRESH_GRACE_MS = 10_000;

export interface IssuedSession {
  accessToken: string;
  /** Raw refresh token to set as cookie; undefined when only the access token must be re-issued (grace window). */
  refreshToken?: string;
  user: UserDto;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Pre-computed hash used to equalise timing when the email does not exist. */
  private dummyHash?: string;

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDoc>,
    @InjectModel(Session.name) private readonly sessions: Model<SessionDoc>,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(email: string, password: string, userAgent?: string): Promise<IssuedSession> {
    const normalized = email.trim().toLowerCase();
    if (await this.users.exists({ email: normalized })) throw conflict('Email already registered', 'EMAIL_TAKEN');
    const now = this.clock.now();
    const verifyToken = randomToken();
    let user: UserDoc;
    try {
      user = await this.users.create({
        email: normalized,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: this.config.adminEmails.includes(normalized) ? 'admin' : 'user',
        maxProfiles: this.config.maxProfilesPerUser,
        verifyTokenHash: sha256(verifyToken),
        verifyTokenExpires: new Date(now.getTime() + VERIFY_TTL_MS),
        termsAcceptedAt: now,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw conflict('Email already registered', 'EMAIL_TAKEN');
      throw err;
    }
    await this.sendVerificationEmail(user.email, verifyToken);
    return this.issue(user, userAgent);
  }

  async login(email: string, password: string, userAgent?: string): Promise<IssuedSession> {
    const user = await this.users.findOne({ email: email.trim().toLowerCase() });
    const now = this.clock.now();
    if (!user) {
      this.dummyHash ??= await argon2.hash('dummy-password-for-timing', { type: argon2.argon2id });
      await argon2.verify(this.dummyHash, password).catch(() => false);
      throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }
    if (user.lockedUntil && user.lockedUntil > now) throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      user.failedLogins += 1;
      if (user.failedLogins >= LOCK_AFTER_FAILURES) {
        user.lockedUntil = new Date(now.getTime() + LOCK_MS);
        user.failedLogins = 0;
      }
      await user.save();
      throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }
    if (user.failedLogins || user.lockedUntil) {
      user.failedLogins = 0;
      user.lockedUntil = undefined;
      await user.save();
    }
    return this.issue(user, userAgent);
  }

  /** Rotating refresh with reuse detection. */
  async refresh(rawToken: string | undefined, userAgent?: string): Promise<IssuedSession & { familyId: string }> {
    if (!rawToken) throw new UnauthorizedException('Missing refresh token');
    const now = this.clock.now();
    const session = await this.sessions.findOne({ tokenHash: sha256(rawToken) });
    if (!session || session.expiresAt <= now) throw new UnauthorizedException('Invalid refresh token');
    const user = await this.users.findById(session.userId);
    if (!user) throw new UnauthorizedException('Invalid refresh token');

    if (session.revokedAt) {
      // Explicitly revoked (logout, password reset...): never accepted again.
      if (!session.rotatedAt) throw new UnauthorizedException('Refresh token revoked');
      if (now.getTime() - session.rotatedAt.getTime() <= REFRESH_GRACE_MS) {
        return { accessToken: this.signAccess(user), user: toUserDto(user.toObject()), familyId: session.familyId };
      }
      // A rotated token presented long after rotation: assume theft and kill the whole family.
      await this.sessions.updateMany({ familyId: session.familyId, revokedAt: { $exists: false } }, { $set: { revokedAt: now } });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    // Atomic claim: only one concurrent request can rotate the token.
    const claimed = await this.sessions.findOneAndUpdate(
      { _id: session._id, revokedAt: { $exists: false } },
      { $set: { revokedAt: now, rotatedAt: now } },
    );
    if (!claimed) {
      return { accessToken: this.signAccess(user), user: toUserDto(user.toObject()), familyId: session.familyId };
    }
    const issued = await this.issue(user, userAgent, session.familyId);
    return { ...issued, familyId: session.familyId };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.sessions.updateOne({ tokenHash: sha256(rawToken), revokedAt: { $exists: false } }, { $set: { revokedAt: this.clock.now() } });
  }

  async familyOf(rawToken: string | undefined): Promise<string | undefined> {
    if (!rawToken) return undefined;
    const s = await this.sessions.findOne({ tokenHash: sha256(rawToken) }).select('familyId').lean();
    return s?.familyId;
  }

  async verifyEmail(token: string): Promise<void> {
    const user = await this.users.findOne({ verifyTokenHash: sha256(token), verifyTokenExpires: { $gt: this.clock.now() } });
    if (!user) throw badRequest('Invalid or expired token', 'INVALID_TOKEN');
    user.emailVerifiedAt = this.clock.now();
    user.verifyTokenHash = undefined;
    user.verifyTokenExpires = undefined;
    await user.save();
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || user.emailVerifiedAt) return;
    const token = randomToken();
    user.verifyTokenHash = sha256(token);
    user.verifyTokenExpires = new Date(this.clock.now().getTime() + VERIFY_TTL_MS);
    await user.save();
    await this.sendVerificationEmail(user.email, token);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findOne({ email: email.trim().toLowerCase() });
    if (!user) return;
    const token = randomToken();
    user.resetTokenHash = sha256(token);
    user.resetTokenExpires = new Date(this.clock.now().getTime() + RESET_TTL_MS);
    await user.save();
    try {
      await this.mail.sendSystem({
        to: user.email,
        subject: 'Reimposta la tua password di Cancellamy',
        paragraphs: [
          'Hai chiesto di reimpostare la password del tuo account Cancellamy.',
          'Il link è valido per un’ora. Se non sei stato tu, ignora questa email: la password non cambierà.',
        ],
        button: { label: 'Reimposta la password', url: `${this.config.appUrl}/reimposta-password?token=${token}` },
      });
    } catch (err) {
      this.logger.error(`reset email failed: ${(err as Error).message}`);
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const user = await this.users.findOne({ resetTokenHash: sha256(token), resetTokenExpires: { $gt: this.clock.now() } });
    if (!user) throw badRequest('Invalid or expired token', 'INVALID_TOKEN');
    user.passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    user.resetTokenHash = undefined;
    user.resetTokenExpires = undefined;
    user.failedLogins = 0;
    user.lockedUntil = undefined;
    await user.save();
    await this.sessions.updateMany({ userId: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: this.clock.now() } });
  }

  private async sendVerificationEmail(to: string, token: string): Promise<void> {
    try {
      await this.mail.sendSystem({
        to,
        subject: 'Conferma il tuo indirizzo email su Cancellamy',
        paragraphs: [
          'Benvenuto su Cancellamy! Conferma il tuo indirizzo email per poter creare il profilo e avviare le richieste di cancellazione.',
          'Il link è valido per 48 ore.',
        ],
        button: { label: 'Conferma email', url: `${this.config.appUrl}/verifica-email?token=${token}` },
      });
    } catch (err) {
      this.logger.error(`verification email failed: ${(err as Error).message}`);
    }
  }

  private signAccess(user: UserDoc): string {
    const payload: JwtPayload = { sub: String(user._id), role: user.role };
    return this.jwt.sign(payload, { expiresIn: ACCESS_TTL_SECONDS });
  }

  private async issue(user: UserDoc, userAgent?: string, familyId?: string): Promise<IssuedSession> {
    const refreshToken = randomToken(48);
    await this.sessions.create({
      userId: user._id as Types.ObjectId,
      tokenHash: sha256(refreshToken),
      familyId: familyId ?? randomUUID(),
      expiresAt: new Date(this.clock.now().getTime() + REFRESH_TTL_MS),
      userAgent: userAgent?.slice(0, 200),
    });
    return { accessToken: this.signAccess(user), refreshToken, user: toUserDto(user.toObject()) };
  }
}

export const REFRESH_COOKIE = 'cnc_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const REFRESH_COOKIE_MAX_AGE = REFRESH_TTL_MS;
