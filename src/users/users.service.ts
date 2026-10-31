import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as argon2 from 'argon2';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import {
  Authorization,
  AuthorizationDoc,
  Message,
  MessageDoc,
  Notification,
  NotificationDoc,
  Profile,
  ProfileDoc,
  RemovalRequest,
  Report,
  ReportDoc,
  RequestDoc,
  Session,
  SessionDoc,
  User,
  UserDoc,
} from '../db/schemas';
import { CryptoService } from '../common/crypto.service';
import { badRequest } from '../common/errors';
import { GmailSettings, revokeGoogleToken } from '../sender/gmail-sender.service';
import type { ProfilePii } from '../profiles/profile.types';

export interface UserDto {
  id: string;
  email: string;
  role: 'user' | 'admin';
  emailVerified: boolean;
  maxProfiles: number;
  settings: { notifyByEmail: boolean; monthlyReport: boolean };
  createdAt: string;
}

export function toUserDto(u: User & { _id: Types.ObjectId }): UserDto {
  return {
    id: String(u._id),
    email: u.email,
    role: u.role,
    emailVerified: !!u.emailVerifiedAt,
    maxProfiles: u.maxProfiles,
    settings: { notifyByEmail: u.settings?.notifyByEmail ?? true, monthlyReport: u.settings?.monthlyReport ?? true },
    createdAt: u.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDoc>,
    @InjectModel(Session.name) private readonly sessions: Model<SessionDoc>,
    @InjectModel(Profile.name) private readonly profiles: Model<ProfileDoc>,
    @InjectModel(Authorization.name) private readonly authorizations: Model<AuthorizationDoc>,
    @InjectModel(RemovalRequest.name) private readonly requests: Model<RequestDoc>,
    @InjectModel(Message.name) private readonly messages: Model<MessageDoc>,
    @InjectModel(Notification.name) private readonly notifications: Model<NotificationDoc>,
    @InjectModel(Report.name) private readonly reports: Model<ReportDoc>,
    private readonly crypto: CryptoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async me(userId: string): Promise<UserDto> {
    const u = await this.users.findById(userId).lean();
    if (!u) throw badRequest('User not found', 'INVALID_TOKEN');
    return toUserDto(u);
  }

  async updateSettings(userId: string, patch: { notifyByEmail?: boolean; monthlyReport?: boolean }): Promise<UserDto> {
    const set: Record<string, boolean> = {};
    if (patch.notifyByEmail !== undefined) set['settings.notifyByEmail'] = patch.notifyByEmail;
    if (patch.monthlyReport !== undefined) set['settings.monthlyReport'] = patch.monthlyReport;
    const u = await this.users.findByIdAndUpdate(userId, { $set: set }, { new: true }).lean();
    if (!u) throw badRequest('User not found', 'INVALID_TOKEN');
    return toUserDto(u);
  }

  async changePassword(userId: string, current: string, next: string, keepFamilyId?: string): Promise<void> {
    const u = await this.users.findById(userId);
    if (!u || !(await argon2.verify(u.passwordHash, current))) throw badRequest('Current password is wrong', 'INVALID_CREDENTIALS');
    u.passwordHash = await argon2.hash(next, { type: argon2.argon2id });
    await u.save();
    await this.sessions.updateMany(
      { userId: u._id, revokedAt: { $exists: false }, ...(keepFamilyId ? { familyId: { $ne: keepFamilyId } } : {}) },
      { $set: { revokedAt: new Date() } },
    );
  }

  /** GDPR art. 20: everything we hold about the user, decrypted. */
  async exportData(userId: string): Promise<Record<string, unknown>> {
    const uid = new Types.ObjectId(userId);
    const [user, profiles, authorizations, requests, messages, notifications, reports] = await Promise.all([
      this.users.findById(uid).lean(),
      this.profiles.find({ userId: uid }).lean(),
      this.authorizations.find({ userId: uid }).lean(),
      this.requests.find({ userId: uid }).lean(),
      this.messages.find({ userId: uid }).sort({ at: 1 }).lean(),
      this.notifications.find({ userId: uid }).lean(),
      this.reports.find({ userId: uid }).lean(),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      user: user ? toUserDto(user) : null,
      profiles: profiles.map((p) => ({
        id: String(p._id),
        status: p.status,
        activatedAt: p.activatedAt ?? null,
        data: this.crypto.decryptJson<ProfilePii>(p.pii),
      })),
      authorizations: authorizations.map((a) => ({
        id: String(a._id),
        profileId: String(a.profileId),
        signedAt: a.signedAt,
        signatureName: this.crypto.decrypt(a.signatureNameEnc),
        textVersion: a.textVersion,
        revokedAt: a.revokedAt ?? null,
      })),
      requests: requests.map((r) => ({
        id: String(r._id),
        profileId: String(r.profileId),
        broker: r.brokerName,
        shortRef: r.shortRef,
        status: r.status,
        channel: r.channel,
        cycle: r.cycle,
        sentAt: r.sentAt ?? null,
        dueAt: r.dueAt ?? null,
        completedAt: r.completedAt ?? null,
        timeline: r.timeline,
      })),
      messages: messages.map((m) => ({
        requestId: String(m.requestId),
        direction: m.direction,
        at: m.at,
        from: m.from,
        to: m.to,
        subject: this.crypto.decrypt(m.subjectEnc),
        text: this.crypto.decrypt(m.textEnc),
        attachments: m.attachments,
      })),
      notifications: notifications.map((n) => ({ title: n.title, body: n.body, readAt: n.readAt ?? null, createdAt: n.createdAt })),
      reports: reports.map((r) => ({ period: r.period, stats: r.stats, highlights: r.highlights })),
    };
  }

  async deleteAccount(userId: string, password: string): Promise<void> {
    const u = await this.users.findById(userId);
    if (!u || !(await argon2.verify(u.passwordHash, password))) throw badRequest('Password is wrong', 'INVALID_CREDENTIALS');
    const uid = u._id;
    for (const p of await this.profiles.find({ userId: uid, gmailEnc: { $exists: true } }).select('gmailEnc').lean()) {
      if (p.gmailEnc) await revokeGoogleToken(this.config.googleRevokeUrl, this.crypto.decryptJson<GmailSettings>(p.gmailEnc).refreshToken);
    }
    await Promise.all([
      this.profiles.deleteMany({ userId: uid }),
      this.authorizations.deleteMany({ userId: uid }),
      this.requests.deleteMany({ userId: uid }),
      this.messages.deleteMany({ userId: uid }),
      this.notifications.deleteMany({ userId: uid }),
      this.reports.deleteMany({ userId: uid }),
      this.sessions.deleteMany({ userId: uid }),
    ]);
    await this.users.deleteOne({ _id: uid });
  }
}
