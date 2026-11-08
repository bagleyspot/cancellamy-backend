import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import {
  Authorization,
  AuthorizationDoc,
  Message,
  MessageDoc,
  Profile,
  ProfileDoc,
  RemovalRequest,
  RequestDoc,
  User,
  UserDoc,
} from '../db/schemas';
import { Clock } from '../common/clock';
import { CryptoService, randomToken } from '../common/crypto.service';
import { badRequest, conflict, forbidden } from '../common/errors';
import { RequestsService } from '../requests/requests.service';
import { RequestCounts, addToCounts, emptyCounts } from '../requests/status';
import { AuthUser } from '../auth/auth.types';
import { IdentityService } from '../identity/identity.service';
import { GmailSettings, revokeGoogleToken } from '../sender/gmail-sender.service';
import { delegaRequired } from './delega';
import { ProfileDataService } from './profile-data.service';
import { ProfileInputDto, UpdateProfileDto } from './profile.dto';
import { ProfilePii, fullName } from './profile.types';

export interface ProfileDtoShape extends ProfilePii {
  id: string;
  status: string;
  identityVerified: boolean;
  senderMode: 'cancellamy' | 'smtp' | 'gmail';
  /** False when the profile sends from its own mailbox: the user writes as the data subject and no delega is needed. */
  authorizationRequired: boolean;
  authorization: { id: string; signedAt: string; signatureName: string; textVersion: string; revokedAt: string | null } | null;
  requestCounts: RequestCounts;
  createdAt: string;
  activatedAt: string | null;
}

function normalisePii(dto: ProfileInputDto | (UpdateProfileDto & Partial<ProfilePii>), base?: ProfilePii): ProfilePii {
  const merged = { ...(base ?? { aliases: [], phones: [], addresses: [], emails: [] }), ...stripUndefined(dto) } as ProfilePii;
  return {
    firstName: merged.firstName.trim(),
    lastName: merged.lastName.trim(),
    ...(merged.dateOfBirth ? { dateOfBirth: merged.dateOfBirth } : {}),
    emails: [...new Set(merged.emails.map((e) => e.trim().toLowerCase()))],
    phones: [...new Set(merged.phones.map((p) => p.trim()))],
    addresses: merged.addresses.map((a) => ({
      street: a.street.trim(),
      city: a.city.trim(),
      zip: a.zip.trim(),
      ...(a.province?.trim() ? { province: a.province.trim() } : {}),
      country: a.country.trim().toUpperCase(),
    })),
    ...(merged.fiscalCode ? { fiscalCode: merged.fiscalCode.trim().toUpperCase() } : {}),
    aliases: [...new Set(merged.aliases.map((a) => a.trim()).filter(Boolean))],
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

@Injectable()
export class ProfilesService {
  constructor(
    @InjectModel(Profile.name) private readonly profiles: Model<ProfileDoc>,
    @InjectModel(Authorization.name) private readonly authorizations: Model<AuthorizationDoc>,
    @InjectModel(RemovalRequest.name) private readonly requests: Model<RequestDoc>,
    @InjectModel(Message.name) private readonly messages: Model<MessageDoc>,
    @InjectModel(User.name) private readonly users: Model<UserDoc>,
    private readonly data: ProfileDataService,
    private readonly requestsService: RequestsService,
    private readonly identity: IdentityService,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private requireVerified(user: AuthUser): void {
    if (!user.emailVerified) throw forbidden('Verify your email first', 'EMAIL_NOT_VERIFIED');
  }

  async list(userId: string): Promise<ProfileDtoShape[]> {
    const docs = await this.profiles.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: 1 });
    return this.toDtos(docs);
  }

  async get(userId: string, id: string): Promise<ProfileDtoShape> {
    const doc = await this.data.getOwned(userId, id);
    return (await this.toDtos([doc]))[0] as ProfileDtoShape;
  }

  async create(user: AuthUser, dto: ProfileInputDto): Promise<ProfileDtoShape> {
    this.requireVerified(user);
    const owner = await this.users.findById(user.id).select('maxProfiles').lean();
    const count = await this.profiles.countDocuments({ userId: new Types.ObjectId(user.id) });
    if (count >= (owner?.maxProfiles ?? this.config.maxProfilesPerUser)) {
      throw conflict('Profile limit reached', 'PROFILE_LIMIT_REACHED');
    }
    const doc = await this.profiles.create({
      userId: new Types.ObjectId(user.id),
      // Without a delega to sign (mailbox mode) the profile is ready as soon as it exists.
      status: delegaRequired({ senderMode: 'cancellamy' }, this.config.mailMode) ? 'draft' : 'ready',
      pii: this.crypto.encryptJson(normalisePii(dto)),
      replyToken: randomToken(12).toLowerCase().replace(/[^a-z0-9]/g, 'x'),
    });
    return (await this.toDtos([doc]))[0] as ProfileDtoShape;
  }

  async update(userId: string, id: string, dto: UpdateProfileDto): Promise<ProfileDtoShape> {
    const doc = await this.data.getOwned(userId, id);
    const current = this.data.pii(doc);
    const next = normalisePii(dto as UpdateProfileDto & Partial<ProfilePii>, current);
    const nameChanged = fullName(next).toLowerCase() !== fullName(current).toLowerCase();
    doc.pii = this.crypto.encryptJson(next);
    // The typed signature must match the name: changing the name invalidates the signed delega.
    if (nameChanged) {
      const auth = await this.data.activeAuthorization(doc._id);
      if (auth) await this.revokeInternal(doc, auth);
    }
    await doc.save();
    return (await this.toDtos([doc]))[0] as ProfileDtoShape;
  }

  async remove(userId: string, id: string): Promise<void> {
    const doc = await this.data.getOwned(userId, id);
    if (doc.gmailEnc) await revokeGoogleToken(this.config.googleRevokeUrl, this.crypto.decryptJson<GmailSettings>(doc.gmailEnc).refreshToken);
    await Promise.all([
      this.messages.deleteMany({ requestId: { $in: await this.requests.find({ profileId: doc._id }).distinct('_id') } }),
      this.requests.deleteMany({ profileId: doc._id }),
      this.authorizations.deleteMany({ profileId: doc._id }),
    ]);
    await this.profiles.deleteOne({ _id: doc._id });
  }

  async getAuthorizationText(userId: string, id: string) {
    const doc = await this.data.getOwned(userId, id);
    return this.data.authorizationText(this.data.pii(doc));
  }

  async sign(userId: string, id: string, signatureName: string, ip: string | undefined, userAgent: string | undefined) {
    const doc = await this.data.getOwned(userId, id);
    const pii = this.data.pii(doc);
    const expected = fullName(pii).toLowerCase();
    if (signatureName.trim().replace(/\s+/g, ' ').toLowerCase() !== expected) {
      throw badRequest('The signature must match first name and last name of the profile', 'VALIDATION_ERROR');
    }
    const existing = await this.data.activeAuthorization(doc._id);
    if (existing) return this.toAuthorizationDto(existing);
    const { version, text } = this.data.authorizationText(pii);
    const auth = await this.authorizations.create({
      profileId: doc._id,
      userId: new Types.ObjectId(userId),
      signedAt: this.clock.now(),
      signatureNameEnc: this.crypto.encrypt(fullName(pii)),
      textVersion: version,
      textHash: createHash('sha256').update(text).digest('hex'),
      ipHash: ip ? createHash('sha256').update(ip).digest('hex') : undefined,
      userAgent: userAgent?.slice(0, 200),
    });
    if (doc.status === 'draft') {
      doc.status = 'ready';
      await doc.save();
    }
    return this.toAuthorizationDto(auth);
  }

  async revoke(userId: string, id: string): Promise<void> {
    const doc = await this.data.getOwned(userId, id);
    const auth = await this.data.activeAuthorization(doc._id);
    if (!auth) return;
    await this.revokeInternal(doc, auth);
  }

  private async revokeInternal(doc: ProfileDoc, auth: AuthorizationDoc): Promise<void> {
    auth.revokedAt = this.clock.now();
    await auth.save();
    doc.status = 'draft';
    await doc.save();
    await this.requestsService.cancelQueuedForProfile(doc._id);
  }

  async authorizationPdf(userId: string, id: string): Promise<Buffer> {
    const doc = await this.data.getOwned(userId, id);
    const auth = await this.data.activeAuthorization(doc._id);
    if (!auth) throw badRequest('No active authorization', 'AUTHORIZATION_REQUIRED');
    return this.data.renderDelegaPdf(doc, auth);
  }

  async activate(user: AuthUser, id: string) {
    this.requireVerified(user);
    const doc = await this.data.getOwned(user.id, id);
    if (doc.status === 'draft') throw conflict('Sign the authorization first', 'PROFILE_NOT_READY');
    if (doc.status === 'active' || doc.status === 'paused') {
      throw conflict('Profile already activated', 'INVALID_STATE');
    }
    doc.status = 'active';
    doc.activatedAt = this.clock.now();
    await doc.save();
    return this.requestsService.createForProfile(doc);
  }

  async setPaused(userId: string, id: string, paused: boolean): Promise<ProfileDtoShape> {
    const doc = await this.data.getOwned(userId, id);
    const from = paused ? 'active' : 'paused';
    if (doc.status !== from) throw conflict(`Profile is not ${from}`, 'INVALID_STATE');
    doc.status = paused ? 'paused' : 'active';
    await doc.save();
    return (await this.toDtos([doc]))[0] as ProfileDtoShape;
  }

  private toAuthorizationDto(a: AuthorizationDoc) {
    return {
      id: String(a._id),
      signedAt: a.signedAt.toISOString(),
      signatureName: this.crypto.decrypt(a.signatureNameEnc),
      textVersion: a.textVersion,
      revokedAt: a.revokedAt ? a.revokedAt.toISOString() : null,
    };
  }

  private async toDtos(docs: ProfileDoc[]): Promise<ProfileDtoShape[]> {
    if (!docs.length) return [];
    const ids = docs.map((d) => d._id);
    const [auths, grouped] = await Promise.all([
      this.authorizations.find({ profileId: { $in: ids }, revokedAt: { $exists: false } }).sort({ signedAt: -1 }),
      this.requests.aggregate<{ _id: { p: Types.ObjectId; s: string }; n: number }>([
        { $match: { profileId: { $in: ids }, kind: { $ne: 'access' } } },
        { $group: { _id: { p: '$profileId', s: '$status' }, n: { $sum: 1 } } },
      ]),
    ]);
    const authByProfile = new Map<string, AuthorizationDoc>();
    for (const a of auths) if (!authByProfile.has(String(a.profileId))) authByProfile.set(String(a.profileId), a);
    const counts = new Map<string, RequestCounts>();
    for (const g of grouped) {
      const key = String(g._id.p);
      const c = counts.get(key) ?? emptyCounts();
      addToCounts(c, g._id.s, g.n);
      counts.set(key, c);
    }
    return docs.map((d) => {
      const auth = authByProfile.get(String(d._id));
      return {
        ...this.data.pii(d),
        id: String(d._id),
        status: d.status,
        identityVerified: this.identity.isVerified(d),
        senderMode: d.senderMode ?? 'cancellamy',
        authorizationRequired: delegaRequired({ senderMode: d.senderMode ?? 'cancellamy' }, this.config.mailMode),
        authorization: auth ? this.toAuthorizationDto(auth) : null,
        requestCounts: counts.get(String(d._id)) ?? emptyCounts(),
        createdAt: d.createdAt.toISOString(),
        activatedAt: d.activatedAt ? d.activatedAt.toISOString() : null,
      };
    });
  }
}

export function assertFound<T>(v: T | null | undefined, what: string): T {
  if (!v) throw new NotFoundException(`${what} not found`);
  return v;
}
