import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { MailQuota, MailQuotaDoc } from '../db/schemas';
import { Clock, addDays } from '../common/clock';

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  current?: number;
  limit?: number;
}

export interface QuotaStatus {
  resend: {
    daily: { used: number; limit: number; systemReserve: number };
    monthly: { used: number; limit: number };
  };
  user?: {
    daily: { used: number; limit: number };
  };
}

@Injectable()
export class MailQuotaService {
  private readonly logger = new Logger(MailQuotaService.name);

  constructor(
    @InjectModel(MailQuota.name) private readonly quotas: Model<MailQuotaDoc>,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Formats date as YYYY-MM-DD in UTC. */
  private dayKey(date: Date = this.clock.now()): string {
    return date.toISOString().slice(0, 10);
  }

  /** Formats date as YYYY-MM in UTC. */
  private monthKey(date: Date = this.clock.now()): string {
    return date.toISOString().slice(0, 7);
  }

  /** Returns midnight UTC of the next day. */
  getStartOfTomorrow(date: Date = this.clock.now()): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0));
  }

  /** Atomically records an email sent via Resend against the daily and monthly global quotas. */
  async recordGlobalSend(via: string): Promise<void> {
    if (via !== 'resend') return;
    const now = this.clock.now();
    const day = `resend:daily:${this.dayKey(now)}`;
    const month = `resend:monthly:${this.monthKey(now)}`;
    const dayExpiry = addDays(now, 7);
    const monthExpiry = addDays(now, 60);

    await Promise.all([
      this.quotas.updateOne({ key: day }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: dayExpiry } }, { upsert: true }),
      this.quotas.updateOne({ key: month }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: monthExpiry } }, { upsert: true }),
    ]);
  }

  /** Atomically records an automated request send for a specific user today. */
  async recordUserSend(userId: Types.ObjectId): Promise<void> {
    const now = this.clock.now();
    const key = `user:daily:${String(userId)}:${this.dayKey(now)}`;
    const expiry = addDays(now, 7);
    await this.quotas.updateOne({ key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: expiry } }, { upsert: true });
  }

  /** Returns the count of automated requests sent today by the given user. */
  async getUserDailySent(userId: Types.ObjectId): Promise<number> {
    const key = `user:daily:${String(userId)}:${this.dayKey()}`;
    const doc = await this.quotas.findOne({ key }).lean();
    return doc?.count ?? 0;
  }

  /** Checks if the user has reached their daily request limit (default 5/day). */
  async canUserSendToday(userId: Types.ObjectId, inBatchCount = 0): Promise<QuotaCheckResult> {
    const current = await this.getUserDailySent(userId);
    const limit = this.config.userDailyRequestLimit;
    if (current + inBatchCount >= limit) {
      return {
        allowed: false,
        reason: `Quota giornaliera utente raggiunta (${current + inBatchCount}/${limit} richieste)`,
        current,
        limit,
      };
    }
    return { allowed: true, current, limit };
  }

  /**
   * Checks whether sending via Resend is permitted under the global daily (100) and monthly (3000) caps.
   * If `isSystem` is false, automated batch emails pause when `limit - systemReserve` is reached (e.g. 95/100),
   * guaranteeing that critical auth/verification emails can always be delivered.
   */
  async canSendGlobal(via: string, isSystem = false): Promise<QuotaCheckResult> {
    if (via !== 'resend') return { allowed: true };

    const now = this.clock.now();
    const dayKey = `resend:daily:${this.dayKey(now)}`;
    const monthKey = `resend:monthly:${this.monthKey(now)}`;

    const [dayDoc, monthDoc] = await Promise.all([
      this.quotas.findOne({ key: dayKey }).lean(),
      this.quotas.findOne({ key: monthKey }).lean(),
    ]);

    const monthCount = monthDoc?.count ?? 0;
    if (monthCount >= this.config.resendMonthlyLimit) {
      this.logger.warn(`Resend monthly quota reached: ${monthCount}/${this.config.resendMonthlyLimit}`);
      return {
        allowed: false,
        reason: `Quota mensile Resend raggiunta (${monthCount}/${this.config.resendMonthlyLimit})`,
        current: monthCount,
        limit: this.config.resendMonthlyLimit,
      };
    }

    const dayCount = dayDoc?.count ?? 0;
    const effectiveLimit = isSystem
      ? this.config.resendDailyLimit
      : Math.max(0, this.config.resendDailyLimit - this.config.resendSystemReserve);

    if (dayCount >= effectiveLimit) {
      this.logger.warn(`Resend daily quota reached: ${dayCount}/${effectiveLimit} (isSystem=${isSystem})`);
      return {
        allowed: false,
        reason: isSystem
          ? `Quota giornaliera Resend raggiunta (${dayCount}/${this.config.resendDailyLimit})`
          : `Quota giornaliera per invio automatico raggiunta (${dayCount}/${effectiveLimit}, riservati ${this.config.resendSystemReserve} per email di sistema)`,
        current: dayCount,
        limit: effectiveLimit,
      };
    }

    return { allowed: true, current: dayCount, limit: effectiveLimit };
  }

  /** Returns current quota usage overview. */
  async getQuotaStatus(userId?: string): Promise<QuotaStatus> {
    const now = this.clock.now();
    const [dayDoc, monthDoc, userDoc] = await Promise.all([
      this.quotas.findOne({ key: `resend:daily:${this.dayKey(now)}` }).lean(),
      this.quotas.findOne({ key: `resend:monthly:${this.monthKey(now)}` }).lean(),
      userId ? this.quotas.findOne({ key: `user:daily:${userId}:${this.dayKey(now)}` }).lean() : null,
    ]);

    return {
      resend: {
        daily: {
          used: dayDoc?.count ?? 0,
          limit: this.config.resendDailyLimit,
          systemReserve: this.config.resendSystemReserve,
        },
        monthly: {
          used: monthDoc?.count ?? 0,
          limit: this.config.resendMonthlyLimit,
        },
      },
      ...(userId
        ? {
            user: {
              daily: {
                used: userDoc?.count ?? 0,
                limit: this.config.userDailyRequestLimit,
              },
            },
          }
        : {}),
    };
  }
}
