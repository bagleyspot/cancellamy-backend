import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomInt } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ContactCode, ContactCodeDoc, ProfileDoc } from '../db/schemas';
import { Clock } from '../common/clock';
import { CryptoService, safeEqual, sha256 } from '../common/crypto.service';
import { badRequest, tooManyRequests } from '../common/errors';
import { MailService } from '../mail/mail.service';
import { ProfileDataService } from '../profiles/profile-data.service';
import { ProfilePii } from '../profiles/profile.types';
import { SmsService } from './sms.service';

type VerifiedListener = (profile: ProfileDoc) => Promise<unknown>;

const CODE_TTL_MS = 15 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;

export interface IdentityDtoShape {
  verified: boolean;
  requiresPhone: boolean;
  contacts: { type: 'email' | 'phone'; value: string; verified: boolean; verifiedAt: string | null }[];
}

export function normaliseContact(type: 'email' | 'phone', value: string): string {
  const v = value.trim();
  return type === 'email' ? v.toLowerCase() : v.replace(/[\s().-]/g, '');
}

/**
 * Proves that the person registering controls the contacts of the profile (codes sent to each email/phone).
 * It is NOT proof that the name is theirs: it raises the cost of impersonation, nothing more.
 */
@Injectable()
export class IdentityService {
  private readonly listeners: VerifiedListener[] = [];

  constructor(
    @InjectModel(ContactCode.name) private readonly codes: Model<ContactCodeDoc>,
    private readonly data: ProfileDataService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Lets other features react when an email becomes verified (kept as a callback to avoid a dependency cycle). */
  onEmailVerified(listener: VerifiedListener): void {
    this.listeners.push(listener);
  }

  private hash(type: 'email' | 'phone', value: string): string {
    return this.crypto.keyedHash(`${type}:${normaliseContact(type, value)}`);
  }

  private requiresPhone(): boolean {
    return this.config.identityRequirePhone && this.sms.enabled;
  }

  status(profile: ProfileDoc, pii: ProfilePii): IdentityDtoShape {
    const verified = new Map(profile.verifiedContacts.map((c) => [c.hash, c.at]));
    const contacts = [
      ...pii.emails.map((value) => ({ type: 'email' as const, value })),
      ...pii.phones.map((value) => ({ type: 'phone' as const, value })),
    ].map((c) => {
      const at = verified.get(this.hash(c.type, c.value));
      return { ...c, verified: !!at, verifiedAt: at ? at.toISOString() : null };
    });
    const requiresPhone = this.requiresPhone();
    const ok = contacts.every((c) => c.verified || (c.type === 'phone' && !requiresPhone));
    return { verified: ok && contacts.some((c) => c.type === 'email'), requiresPhone, contacts };
  }

  isVerified(profile: ProfileDoc): boolean {
    return this.status(profile, this.data.pii(profile)).verified;
  }

  verifiedEmails(profile: ProfileDoc): string[] {
    return this.status(profile, this.data.pii(profile)).contacts.filter((c) => c.type === 'email' && c.verified).map((c) => c.value);
  }

  async get(userId: string, profileId: string): Promise<IdentityDtoShape> {
    const profile = await this.data.getOwned(userId, profileId);
    return this.status(profile, this.data.pii(profile));
  }

  async sendCode(userId: string, profileId: string, type: 'email' | 'phone', value: string): Promise<void> {
    const profile = await this.data.getOwned(userId, profileId);
    const pii = this.data.pii(profile);
    const norm = normaliseContact(type, value);
    const owned = (type === 'email' ? pii.emails : pii.phones).find((v) => normaliseContact(type, v) === norm);
    if (!owned) throw badRequest('The value is not a contact of this profile', 'VALIDATION_ERROR');
    if (type === 'phone' && !this.sms.enabled) throw badRequest('Phone verification is not available on this instance', 'FEATURE_DISABLED');

    const hash = this.hash(type, owned);
    const now = this.clock.now();
    let doc = await this.codes.findOne({ profileId: profile._id, type, hash });
    if (doc) {
      if (now.getTime() - doc.lastSentAt.getTime() < COOLDOWN_MS) throw tooManyRequests('Wait a minute before asking for a new code', 'VERIFICATION_RATE_LIMITED');
      if (now.getTime() - doc.windowStart.getTime() > WINDOW_MS) {
        doc.windowStart = now;
        doc.sends = 0;
      }
      if (doc.sends >= MAX_SENDS_PER_WINDOW) throw tooManyRequests('Too many codes requested, try again later', 'VERIFICATION_RATE_LIMITED');
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = sha256(`${String(profile._id)}:${hash}:${code}`);
    if (doc) {
      doc.codeHash = codeHash;
      doc.attempts = 0;
      doc.sends += 1;
      doc.lastSentAt = now;
      doc.expiresAt = new Date(now.getTime() + CODE_TTL_MS);
      await doc.save();
    } else {
      doc = await this.codes.create({
        profileId: profile._id,
        type,
        hash,
        codeHash,
        attempts: 0,
        sends: 1,
        windowStart: now,
        lastSentAt: now,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      });
    }
    if (type === 'email') {
      await this.mail.sendSystem({
        to: owned,
        subject: `Il tuo codice di verifica Cancellamy: ${code}`,
        paragraphs: [
          `Il codice per confermare questo indirizzo è ${code}.`,
          'Vale 15 minuti. Se non l\'hai chiesto tu, ignora questa email.',
        ],
      });
    } else {
      await this.sms.send(owned, `Cancellamy: il tuo codice di verifica è ${code}. Vale 15 minuti.`);
    }
  }

  async confirm(userId: string, profileId: string, type: 'email' | 'phone', value: string, code: string): Promise<IdentityDtoShape> {
    const profile = await this.data.getOwned(userId, profileId);
    const hash = this.hash(type, value);
    const doc = await this.codes.findOne({ profileId: profile._id, type, hash });
    const now = this.clock.now();
    if (!doc || doc.expiresAt <= now) throw badRequest('The code is invalid or expired', 'VERIFICATION_CODE_INVALID');
    if (doc.attempts >= MAX_ATTEMPTS) {
      await doc.deleteOne();
      throw tooManyRequests('Too many wrong attempts: ask for a new code', 'VERIFICATION_RATE_LIMITED');
    }
    const expected = sha256(`${String(profile._id)}:${hash}:${code}`);
    if (!safeEqual(expected, doc.codeHash)) {
      doc.attempts += 1;
      await doc.save();
      throw badRequest('The code is invalid or expired', 'VERIFICATION_CODE_INVALID');
    }
    if (!profile.verifiedContacts.some((c) => c.hash === hash)) {
      profile.verifiedContacts.push({ type, hash, at: now });
      await profile.save();
    }
    await doc.deleteOne();
    if (type === 'email') for (const l of this.listeners) await l(profile).catch(() => undefined);
    return this.status(profile, this.data.pii(profile));
  }
}
