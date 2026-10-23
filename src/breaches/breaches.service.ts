import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { APP_CONFIG, AppConfig, computeFeatures } from '../config/app-config';
import { BreachCheck, BreachCheckDoc, Profile, ProfileDoc } from '../db/schemas';
import { Clock, addDays } from '../common/clock';
import { CryptoService } from '../common/crypto.service';
import { CodedException, tooManyRequests } from '../common/errors';
import { IdentityService } from '../identity/identity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProfileDataService } from '../profiles/profile-data.service';

export const BREACH_ATTRIBUTION = 'Dati sulle violazioni forniti da Have I Been Pwned (https://haveibeenpwned.com).';
const MANUAL_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface HibpBreach {
  Name: string;
  Title?: string;
  Domain?: string;
  BreachDate?: string;
  AddedDate?: string;
  DataClasses?: string[];
  IsVerified?: boolean;
  IsSensitive?: boolean;
}

class RateLimited extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('rate limited');
  }
}

@Injectable()
export class BreachesService {
  private readonly logger = new Logger(BreachesService.name);

  constructor(
    @InjectModel(BreachCheck.name) private readonly checks: Model<BreachCheckDoc>,
    @InjectModel(Profile.name) private readonly profiles: Model<ProfileDoc>,
    private readonly data: ProfileDataService,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationsService,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    // Start checking an email as soon as its owner proves it is theirs.
    this.identity.onEmailVerified(async (profile) => {
      if (this.enabled) await this.ensureChecks(profile);
    });
  }

  get enabled(): boolean {
    return computeFeatures(this.config).breachCheck;
  }

  private hash(email: string): string {
    return this.crypto.keyedHash(`breach:${email.trim().toLowerCase()}`);
  }

  /** Creates the pending checks for the emails whose ownership was verified. */
  async ensureChecks(profile: ProfileDoc): Promise<string[]> {
    const verified = this.identity.verifiedEmails(profile);
    for (const email of verified) {
      const emailHash = this.hash(email);
      await this.checks
        .updateOne(
          { profileId: profile._id, emailHash },
          {
            $setOnInsert: {
              profileId: profile._id,
              userId: profile.userId,
              emailHash,
              emailEnc: this.crypto.encrypt(email.trim().toLowerCase()),
              status: 'pending',
              nextCheckAt: this.clock.now(),
              breaches: [],
              notifiedOnce: false,
            },
          },
          { upsert: true },
        )
        .catch((err: { code?: number }) => {
          if (err.code !== 11000) throw err;
        });
    }
    return verified;
  }

  async summary(userId: string, profileId: string) {
    const profile = await this.data.getOwned(userId, profileId);
    if (!this.enabled) return { enabled: false, attribution: BREACH_ATTRIBUTION, emails: [], unverifiedEmails: [] };
    const verified = await this.ensureChecks(profile);
    const all = this.data.pii(profile).emails;
    const docs = await this.checks.find({ profileId: profile._id });
    const byHash = new Map(docs.map((d) => [d.emailHash, d]));
    return {
      enabled: true,
      attribution: BREACH_ATTRIBUTION,
      emails: verified.map((email) => {
        const d = byHash.get(this.hash(email));
        return {
          email,
          status: d?.status ?? 'pending',
          lastCheckedAt: d?.lastCheckedAt ? d.lastCheckedAt.toISOString() : null,
          breaches: (d?.breaches ?? []).map((b) => ({
            name: b.name,
            title: b.title ?? b.name,
            breachDate: b.breachDate ?? null,
            addedDate: b.addedDate ?? null,
            dataClasses: b.dataClasses,
            domain: b.domain ?? null,
            isVerified: b.isVerified,
            isSensitive: b.isSensitive,
          })),
        };
      }),
      unverifiedEmails: all.filter((e) => !verified.includes(e)),
    };
  }

  async checkNow(userId: string, profileId: string): Promise<{ queued: number }> {
    if (!this.enabled) throw new CodedException(404, 'Breach checking is not configured on this instance', 'FEATURE_DISABLED');
    const profile = await this.data.getOwned(userId, profileId);
    const now = this.clock.now();
    if (profile.breachManualCheckAt && now.getTime() - profile.breachManualCheckAt.getTime() < MANUAL_CHECK_INTERVAL_MS) {
      throw tooManyRequests('You can request a new check once an hour', 'RATE_LIMITED');
    }
    await this.ensureChecks(profile);
    const res = await this.checks.updateMany({ profileId: profile._id }, { $set: { nextCheckAt: now, status: 'pending' }, $unset: { lockedUntil: 1 } });
    profile.breachManualCheckAt = now;
    await profile.save();
    return { queued: res.modifiedCount };
  }

  /** Scheduler task: query HIBP for the checks that are due, slowly (the API has a low rate limit). */
  async runDue(limit: number): Promise<number> {
    if (!this.enabled) return 0;
    const now = this.clock.now();
    let done = 0;
    for (let i = 0; i < limit; i++) {
      const doc = await this.checks.findOneAndUpdate(
        { nextCheckAt: { $lte: now }, $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }] },
        { $set: { lockedUntil: new Date(now.getTime() + 5 * 60 * 1000) } },
        { sort: { nextCheckAt: 1 }, new: true },
      );
      if (!doc) break;
      try {
        await this.process(doc);
        done += 1;
      } catch (err) {
        await this.failed(doc, err);
      }
      if (this.config.hibpRequestIntervalMs > 0) await sleep(this.config.hibpRequestIntervalMs);
    }
    return done;
  }

  private async query(email: string): Promise<HibpBreach[]> {
    const res = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`, {
      headers: { 'hibp-api-key': this.config.haveIBeenPwnedApiKey, 'user-agent': this.config.hibpUserAgent },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return [];
    if (res.status === 429) throw new RateLimited(Number(res.headers.get('retry-after') ?? 60));
    if (res.status === 401 || res.status === 403) throw new Error('The Have I Been Pwned API key was rejected');
    if (!res.ok) throw new Error(`Have I Been Pwned answered ${res.status}`);
    return (await res.json()) as HibpBreach[];
  }

  private async process(doc: BreachCheckDoc): Promise<void> {
    const email = this.crypto.decrypt(doc.emailEnc);
    const found = await this.query(email);
    const known = new Set(doc.breaches.map((b) => b.name));
    const fresh = found.filter((b) => !known.has(b.Name));
    const first = !doc.notifiedOnce;
    doc.breaches = found.map((b) => ({
      name: b.Name,
      title: b.Title,
      breachDate: b.BreachDate,
      addedDate: b.AddedDate,
      dataClasses: b.DataClasses ?? [],
      domain: b.Domain,
      isVerified: !!b.IsVerified,
      isSensitive: !!b.IsSensitive,
    }));
    doc.status = 'checked';
    doc.lastCheckedAt = this.clock.now();
    doc.nextCheckAt = addDays(this.clock.now(), this.config.breachRecheckDays);
    doc.lockedUntil = undefined;
    doc.lastError = undefined;
    doc.notifiedOnce = true;
    await doc.save();
    const path = `/app/profili/${String(doc.profileId)}`;
    if (first && found.length > 0) {
      await this.notifications.notify(doc.userId, {
        type: 'system',
        title: `La tua email compare in ${found.length} ${found.length === 1 ? 'violazione' : 'violazioni'} di dati`,
        body: `Controlla l'elenco nella scheda del profilo e cambia le password dei servizi coinvolti. ${BREACH_ATTRIBUTION}`,
        appPath: path,
      });
    } else if (!first && fresh.length > 0) {
      await this.notifications.notify(doc.userId, {
        type: 'system',
        title: `Nuova violazione di dati: ${fresh.map((b) => b.Title ?? b.Name).slice(0, 3).join(', ')}`,
        body: `La tua email compare in ${fresh.length} nuov${fresh.length === 1 ? 'a violazione' : 'e violazioni'}. Cambia le password dei servizi coinvolti. ${BREACH_ATTRIBUTION}`,
        appPath: path,
      });
    }
  }

  private async failed(doc: BreachCheckDoc, err: unknown): Promise<void> {
    doc.lockedUntil = undefined;
    if (err instanceof RateLimited) {
      doc.nextCheckAt = new Date(this.clock.now().getTime() + Math.max(err.retryAfterSeconds, 1) * 1000);
    } else {
      doc.status = 'error';
      doc.lastError = (err as Error).message.slice(0, 200);
      doc.nextCheckAt = new Date(this.clock.now().getTime() + 60 * 60 * 1000);
      this.logger.warn(`breach check failed: ${doc.lastError}`);
    }
    await doc.save();
  }
}
