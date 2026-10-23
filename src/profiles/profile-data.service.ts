import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Authorization, AuthorizationDoc, Profile, ProfileDoc } from '../db/schemas';
import { CryptoService } from '../common/crypto.service';
import { PdfService } from '../pdf/pdf.service';
import { AUTHORIZATION_TEXT_VERSION, buildAuthorizationText } from '../templates/authorization-text';
import { ProfilePii, fullName } from './profile.types';

/** Shared access to profile documents and their decrypted personal data. */
@Injectable()
export class ProfileDataService {
  constructor(
    @InjectModel(Profile.name) private readonly profiles: Model<ProfileDoc>,
    @InjectModel(Authorization.name) private readonly authorizations: Model<AuthorizationDoc>,
    private readonly crypto: CryptoService,
    private readonly pdf: PdfService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Loads a profile owned by the user or throws 404 (never reveals other users' profiles). */
  async getOwned(userId: string, profileId: string): Promise<ProfileDoc> {
    const p = await this.profiles.findOne({ _id: profileId, userId: new Types.ObjectId(userId) });
    if (!p) throw new NotFoundException('Profile not found');
    return p;
  }

  pii(profile: Pick<Profile, 'pii'>): ProfilePii {
    return this.crypto.decryptJson<ProfilePii>(profile.pii);
  }

  async activeAuthorization(profileId: Types.ObjectId | string): Promise<AuthorizationDoc | null> {
    return this.authorizations.findOne({ profileId, revokedAt: { $exists: false } }).sort({ signedAt: -1 });
  }

  /** Address brokers must reply to; the token maps the reply back to the profile. */
  replyAddress(profile: Pick<Profile, 'replyToken'>): string {
    return `r-${profile.replyToken}@${this.config.inboundDomain}`;
  }

  authorizationText(pii: ProfilePii): { version: string; text: string } {
    return { version: AUTHORIZATION_TEXT_VERSION, text: buildAuthorizationText(fullName(pii), this.config.operatorName) };
  }

  async renderDelegaPdf(profile: ProfileDoc, auth: AuthorizationDoc): Promise<Buffer> {
    const pii = this.pii(profile);
    const { text } = this.authorizationText(pii);
    return this.pdf.render({
      title: "Delega per l'esercizio dei diritti GDPR",
      body: text,
      meta: `Delegante: ${fullName(pii)}`,
      footer: [
        `Firmata elettronicamente da ${this.crypto.decrypt(auth.signatureNameEnc)} il ${auth.signedAt.toISOString()} (UTC).`,
        `ID autorizzazione: ${String(auth._id)} - versione testo: ${auth.textVersion} - impronta testo (SHA-256): ${auth.textHash}`,
        `Operatore: ${this.config.operatorName}`,
      ],
    });
  }
}
