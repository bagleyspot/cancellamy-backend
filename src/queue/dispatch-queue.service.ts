import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Profile, ProfileDoc, RemovalRequest, RequestDoc } from '../db/schemas';
import { Clock } from '../common/clock';
import { MailQuotaService } from '../mail/mail-quota.service';
import { RequestEngine } from '../requests/request-engine';
import { DISPATCH_QUEUE_NAME, DispatchJobData } from './queue.types';

@Injectable()
export class DispatchQueueService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DispatchQueueService.name);
  private connection?: Redis;
  private queue?: Queue<DispatchJobData>;
  private worker?: Worker<DispatchJobData>;

  constructor(
    @InjectModel(RemovalRequest.name) private readonly requests: Model<RequestDoc>,
    @InjectModel(Profile.name) private readonly profiles: Model<ProfileDoc>,
    private readonly mailQuota: MailQuotaService,
    private readonly engine: RequestEngine,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.queueEnabled) {
      this.logger.log('BullMQ dispatch queue disabled by configuration (queueEnabled=false)');
      return;
    }

    try {
      this.connection = new Redis(this.config.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
        connectTimeout: 5000,
        tls: this.config.redisTls ? {} : undefined,
      });

      await this.connection.connect();
      this.logger.log(`BullMQ connected to Redis at ${this.config.redisHost}:${this.config.redisPort}`);

      this.queue = new Queue<DispatchJobData>(DISPATCH_QUEUE_NAME, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: 200,
          removeOnFail: 500,
        },
      });

      this.worker = new Worker<DispatchJobData>(
        DISPATCH_QUEUE_NAME,
        async (job) => this.processDispatchJob(job),
        {
          connection: this.connection,
          concurrency: 1, // Serial dispatch prevents bursts and protects Resend rate limit
          limiter: {
            max: 1,
            duration: 600, // Enforce at least 600ms between sends
          },
        },
      );

      this.worker.on('failed', (job, err) => {
        this.logger.error(`Job ${job?.id} (request ${job?.data?.requestId}) failed: ${err.message}`);
      });
    } catch (err) {
      this.logger.warn(`Failed to initialize BullMQ queue: ${(err as Error).message}. Falling back to scheduler direct dispatch.`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
    if (this.connection) {
      try {
        await this.connection.quit();
      } catch {
        this.connection.disconnect();
      }
    }
  }

  get isReady(): boolean {
    return !!this.queue && !!this.worker;
  }

  /**
   * Enqueues a single request dispatch job into BullMQ with deduplication and optional delay.
   */
  async enqueueRequest(
    req: { id: string; userId: string; profileId: string; brokerKey?: string; cycle?: number },
    opts?: { delay?: number; scheduledAt?: Date },
  ): Promise<boolean> {
    if (!this.queue) return false;

    let delay = 0;
    if (opts?.delay !== undefined) {
      delay = Math.max(0, opts.delay);
    } else if (opts?.scheduledAt) {
      delay = Math.max(0, opts.scheduledAt.getTime() - this.clock.now().getTime());
    }

    const data: DispatchJobData = {
      requestId: req.id,
      userId: req.userId,
      profileId: req.profileId,
      brokerKey: req.brokerKey,
      cycle: req.cycle,
    };

    const jobId = `dispatch-${req.id}`;
    await this.queue.add('dispatch', data, {
      delay,
      jobId,
    });
    return true;
  }

  /**
   * Enqueues a batch of requests automatically staggered across days (fair-share).
   * First batch of `batchLimit` (default 5) is dispatched today with small spacing.
   * Subsequent batches are delayed by 1 day, 2 days, etc.
   */
  async enqueueBatch(
    items: Array<{ id: string; userId: string; profileId: string; brokerKey?: string; cycle?: number }>,
    batchLimit = this.config.userDailyRequestLimit,
  ): Promise<number> {
    if (!this.queue || !items.length) return 0;

    let enqueued = 0;
    const now = this.clock.now();

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const dayOffset = Math.floor(i / batchLimit);
      const slotInDay = i % batchLimit;
      // Stagger within the day: 3 seconds between each send in the batch
      const delayMs = dayOffset * 24 * 60 * 60 * 1000 + slotInDay * 3000;
      const scheduledAt = new Date(now.getTime() + delayMs);

      const ok = await this.enqueueRequest(item, { delay: delayMs, scheduledAt });
      if (ok) enqueued += 1;
    }

    this.logger.log(`Enqueued batch of ${enqueued} requests in BullMQ staggered across ${Math.ceil(items.length / batchLimit)} days.`);
    return enqueued;
  }

  /**
   * Syncs any pending/due requests from MongoDB into the BullMQ queue.
   */
  async enqueueDueRequests(limit = 50): Promise<number> {
    if (!this.queue) return 0;
    const now = this.clock.now();
    const due = await this.requests
      .find({
        status: 'queued',
        channel: 'email',
        nextAttemptAt: { $lte: now },
        $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }],
      })
      .limit(limit);

    let count = 0;
    for (const req of due) {
      const ok = await this.enqueueRequest({
        id: String(req._id),
        userId: String(req.userId),
        profileId: String(req.profileId),
        brokerKey: req.brokerKey,
        cycle: req.cycle,
      });
      if (ok) count += 1;
    }
    return count;
  }

  /**
   * Worker handler: checks active profile, global quota and per-user daily limit before sending.
   */
  async processDispatchJob(job: Job<DispatchJobData>): Promise<void> {
    const { requestId } = job.data;
    const req = await this.requests.findById(requestId);
    if (!req || req.status !== 'queued' || req.channel !== 'email') {
      return; // cancelled, completed or converted to manual
    }

    const profile = await this.profiles.findById(req.profileId).select('status senderError').lean();
    if (profile?.status !== 'active' || profile.senderError) {
      // Profile paused or mailbox broken: postpone by 10 minutes
      req.nextAttemptAt = new Date(this.clock.now().getTime() + 10 * 60 * 1000);
      await req.save();
      return;
    }

    // 1. Global Resend quota check (100/day, 3000/month, 5 reserve)
    const globalCheck = await this.mailQuota.canSendGlobal(this.config.mailMode, false);
    if (!globalCheck.allowed) {
      this.logger.warn(`BullMQ worker: ${globalCheck.reason}. Postponing dispatch to tomorrow.`);
      const tomorrow = this.mailQuota.getStartOfTomorrow(this.clock.now());
      req.nextAttemptAt = tomorrow;
      await req.save();
      const delay = Math.max(1000, tomorrow.getTime() - this.clock.now().getTime());
      if (this.queue) {
        await this.queue.add('dispatch', job.data, { delay, jobId: `dispatch-${req._id}-${tomorrow.toISOString().slice(0, 10)}` });
      }
      return;
    }

    // 2. User fair-share check (max 5 requests/day)
    const userCheck = await this.mailQuota.canUserSendToday(req.userId);
    if (!userCheck.allowed) {
      this.logger.warn(`BullMQ worker: ${userCheck.reason}. Postponing request ${req.shortRef} to tomorrow.`);
      const tomorrow = this.mailQuota.getStartOfTomorrow(this.clock.now());
      req.nextAttemptAt = tomorrow;
      await req.save();
      const delay = Math.max(1000, tomorrow.getTime() - this.clock.now().getTime());
      if (this.queue) {
        await this.queue.add('dispatch', job.data, { delay, jobId: `dispatch-${req._id}-${tomorrow.toISOString().slice(0, 10)}` });
      }
      return;
    }

    // 3. Deliver request atomically
    const outcome = await this.engine.deliverClaimed(req);
    this.logger.log(`BullMQ executed delivery for ${req.shortRef}: outcome=${outcome}`);
  }
}
