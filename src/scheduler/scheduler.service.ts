import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Lock, LockDoc } from '../db/schemas';
import { Clock } from '../common/clock';
import { MailService } from '../mail/mail.service';
import { ReportsService } from '../reports/reports.service';
import { RequestEngine } from '../requests/request-engine';
import { BreachesService } from '../breaches/breaches.service';
import { DelistingsService } from '../delistings/delistings.service';
import { NuisanceService } from '../nuisance/nuisance.service';
import { DispatchQueueService } from '../queue/dispatch-queue.service';

const LOCK_ID = 'scheduler';
const LOCK_TTL_MS = 5 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TickResult {
  ran: boolean;
  synced: number;
  sent: number;
  retried: number;
  failed: number;
  overdue: number;
  reminders: number;
  renewals: number;
  reports: number;
  breaches: number;
  followUps: number;
}

/**
 * Periodic jobs. Safe with several instances: a lease in MongoDB allows one runner at a time and every
 * task claims its work atomically, so a repeated or concurrent tick never sends anything twice.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly owner = randomUUID();
  private timer?: NodeJS.Timeout;
  private current?: Promise<TickResult>;

  constructor(
    @InjectModel(Lock.name) private readonly locks: Model<LockDoc>,
    private readonly engine: RequestEngine,
    private readonly reports: ReportsService,
    private readonly breaches: BreachesService,
    private readonly delistings: DelistingsService,
    private readonly nuisance: NuisanceService,
    private readonly mail: MailService,
    private readonly dispatchQueue: DispatchQueueService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.schedulerEnabled || this.config.nodeEnv === 'test') return;
    this.timer = setInterval(() => void this.safeTick(), this.config.schedulerIntervalSeconds * 1000);
    this.timer.unref();
    this.logger.log(`scheduler started (every ${this.config.schedulerIntervalSeconds}s)`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.current?.catch(() => undefined);
  }

  private async safeTick(): Promise<void> {
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(`tick failed: ${(err as Error).stack ?? err}`);
    }
  }

  private async acquire(): Promise<boolean> {
    const now = this.clock.now();
    try {
      const doc = await this.locks.findOneAndUpdate(
        { _id: LOCK_ID, until: { $lt: now } },
        { $set: { until: new Date(now.getTime() + LOCK_TTL_MS), owner: this.owner } },
        { upsert: true, new: true },
      );
      return doc?.owner === this.owner;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return false; // someone else holds a valid lease
      throw err;
    }
  }

  private async release(): Promise<void> {
    await this.locks.updateOne({ _id: LOCK_ID, owner: this.owner }, { $set: { until: new Date(0) } });
  }

  /** Runs one iteration of all jobs. Concurrent calls in the same process share the same run. */
  tick(): Promise<TickResult> {
    if (this.current) return this.current;
    this.current = this.runTick().finally(() => {
      this.current = undefined;
    });
    return this.current;
  }

  private async runTick(): Promise<TickResult> {
    const result: TickResult = { ran: false, synced: 0, sent: 0, retried: 0, failed: 0, overdue: 0, reminders: 0, renewals: 0, reports: 0, breaches: 0, followUps: 0 };
    if (!(await this.acquire())) return result;
    result.ran = true;
    try {
      result.overdue = (await this.engine.markOverdue()).length;
      result.synced = await this.engine.syncNewBrokers(20);
      if (this.dispatchQueue.isReady) {
        await this.dispatchQueue.enqueueDueRequests(this.config.sendBatchSize);
      }
      for (const req of await this.engine.claimQueued(this.config.sendBatchSize)) {
        const outcome = await this.engine.deliverClaimed(req);
        if (outcome === 'sent') result.sent += 1;
        else if (outcome === 'retry') result.retried += 1;
        else result.failed += 1;
        // Resend allows ~2 requests/second: stay below it when really sending.
        if (!this.mail.dryRun) await sleep(600);
      }
      result.reminders = await this.engine.sendDueReminders(this.config.sendBatchSize);
      result.renewals = await this.engine.createRenewals(50);
      result.reports = await this.reports.generateMonthly(50);
      result.followUps = (await this.delistings.notifyFollowUps(50)) + (await this.nuisance.notifyRpoFollowUps(50));
      result.breaches = await this.breaches.runDue(3);
    } finally {
      await this.release();
    }
    return result;
  }
}
