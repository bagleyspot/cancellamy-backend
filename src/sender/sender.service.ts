import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Profile, ProfileDoc, RemovalRequest, RequestDoc } from '../db/schemas';
import { Clock } from '../common/clock';
import { CryptoService } from '../common/crypto.service';
import { badRequest, CodedException } from '../common/errors';
import { ProfileDataService } from '../profiles/profile-data.service';
import { SetSenderDto, SmtpInputDto } from './sender.dto';
import { SmtpConfigError, SmtpSenderService, SmtpSettings } from './smtp-sender.service';

export interface SenderDtoShape {
  mode: 'cancellamy' | 'smtp';
  smtp: { host: string; port: number; secure: boolean; username: string; fromAddress: string } | null;
  verifiedAt: string | null;
  lastError: string | null;
  replyAddress: string;
}

@Injectable()
export class SenderService {
  constructor(
    @InjectModel(Profile.name) private readonly profiles: Model<ProfileDoc>,
    @InjectModel(RemovalRequest.name) private readonly requests: Model<RequestDoc>,
    private readonly data: ProfileDataService,
    private readonly smtp: SmtpSenderService,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
  ) {}

  private toDto(profile: ProfileDoc): SenderDtoShape {
    const s = profile.smtpEnc ? this.crypto.decryptJson<SmtpSettings>(profile.smtpEnc) : null;
    return {
      mode: profile.senderMode,
      smtp: s ? { host: s.host, port: s.port, secure: s.secure, username: s.username, fromAddress: s.fromAddress } : null,
      verifiedAt: profile.smtpVerifiedAt ? profile.smtpVerifiedAt.toISOString() : null,
      lastError: profile.senderError ?? null,
      replyAddress: this.data.replyAddress(profile),
    };
  }

  async get(userId: string, profileId: string): Promise<SenderDtoShape> {
    return this.toDto(await this.data.getOwned(userId, profileId));
  }

  private async verify(profile: ProfileDoc, input: SmtpInputDto): Promise<void> {
    const emails = this.data.pii(profile).emails;
    if (!emails.includes(input.fromAddress.trim().toLowerCase())) {
      throw badRequest('fromAddress must be one of the emails of the profile', 'VALIDATION_ERROR');
    }
    try {
      await this.smtp.verify(input);
    } catch (err) {
      if (err instanceof SmtpConfigError) throw new CodedException(400, err.message, err.code);
      throw err;
    }
  }

  async set(userId: string, profileId: string, dto: SetSenderDto): Promise<SenderDtoShape> {
    const profile = await this.data.getOwned(userId, profileId);
    if (dto.mode === 'cancellamy') return this.clear(profile);
    if (!dto.smtp) throw badRequest('smtp settings are required', 'VALIDATION_ERROR');
    const settings: SmtpSettings = { ...dto.smtp, host: dto.smtp.host.trim(), fromAddress: dto.smtp.fromAddress.trim().toLowerCase() };
    await this.verify(profile, settings);
    profile.senderMode = 'smtp';
    profile.smtpEnc = this.crypto.encryptJson(settings);
    profile.smtpVerifiedAt = this.clock.now();
    profile.senderError = undefined;
    await profile.save();
    await this.wake(profile);
    return this.toDto(profile);
  }

  async test(userId: string, profileId: string, input?: SmtpInputDto): Promise<{ ok: true }> {
    const profile = await this.data.getOwned(userId, profileId);
    const settings = input ?? (profile.smtpEnc ? this.crypto.decryptJson<SmtpSettings>(profile.smtpEnc) : null);
    if (!settings) throw badRequest('No SMTP settings to test', 'VALIDATION_ERROR');
    await this.verify(profile, settings);
    return { ok: true };
  }

  async remove(userId: string, profileId: string): Promise<SenderDtoShape> {
    return this.clear(await this.data.getOwned(userId, profileId));
  }

  private async clear(profile: ProfileDoc): Promise<SenderDtoShape> {
    profile.senderMode = 'cancellamy';
    profile.smtpEnc = undefined;
    profile.smtpVerifiedAt = undefined;
    profile.senderError = undefined;
    await profile.save();
    await this.wake(profile);
    return this.toDto(profile);
  }

  /** After a sender change the requests that were waiting on a broken mailbox can go out right away. */
  private async wake(profile: ProfileDoc): Promise<void> {
    await this.requests.updateMany(
      { profileId: profile._id, status: 'queued' },
      { $set: { nextAttemptAt: this.clock.now() }, $unset: { lockedUntil: 1 } },
    );
  }
}
