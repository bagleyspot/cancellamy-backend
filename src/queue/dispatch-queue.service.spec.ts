import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { DispatchQueueService } from './dispatch-queue.service';
import { Profile, RemovalRequest } from '../db/schemas';
import { MailQuotaService } from '../mail/mail-quota.service';
import { RequestEngine } from '../requests/request-engine';
import { Clock } from '../common/clock';
import { APP_CONFIG } from '../config/app-config';
import { Types } from 'mongoose';

describe('DispatchQueueService', () => {
  let service: DispatchQueueService;
  let clock: Clock;
  let mockRequests: any;
  let mockProfiles: any;
  let mockMailQuota: any;
  let mockEngine: any;

  beforeEach(async () => {
    clock = new Clock();
    mockRequests = {
      findById: jest.fn(),
      find: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    mockProfiles = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ status: 'active' }),
        }),
      }),
    };
    mockMailQuota = {
      canSendGlobal: jest.fn().mockResolvedValue({ allowed: true }),
      canUserSendToday: jest.fn().mockResolvedValue({ allowed: true }),
      getStartOfTomorrow: jest.fn().mockReturnValue(new Date(clock.now().getTime() + 24 * 60 * 60 * 1000)),
      recordUserSend: jest.fn().mockResolvedValue(undefined),
    };
    mockEngine = {
      deliverClaimed: jest.fn().mockResolvedValue('sent'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchQueueService,
        { provide: getModelToken(RemovalRequest.name), useValue: mockRequests },
        { provide: getModelToken(Profile.name), useValue: mockProfiles },
        { provide: MailQuotaService, useValue: mockMailQuota },
        { provide: RequestEngine, useValue: mockEngine },
        { provide: Clock, useValue: clock },
        {
          provide: APP_CONFIG,
          useValue: {
            redisUrl: 'redis://localhost:6379',
            redisHost: 'localhost',
            redisPort: 6379,
            redisUsername: 'default',
            redisPassword: 'password',
            redisTls: false,
            queueEnabled: false, // Disabled in unit test module bootstrap
            userDailyRequestLimit: 5,
            mailMode: 'dry-run',
          },
        },
      ],
    }).compile();

    service = module.get<DispatchQueueService>(DispatchQueueService);
  });

  it('initializes in disabled state without error when queueEnabled=false', async () => {
    await service.onApplicationBootstrap();
    expect(service.isReady).toBe(false);
  });

  it('staggers batch items across daily batches with 5 items per day', async () => {
    // Provide a mocked queue
    const addedJobs: any[] = [];
    (service as any).queue = {
      add: jest.fn().mockImplementation((name, data, opts) => {
        addedJobs.push({ name, data, opts });
        return Promise.resolve({ id: opts.jobId });
      }),
    };

    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `req-${i + 1}`,
      userId: 'user-1',
      profileId: 'profile-1',
      brokerKey: `broker-${i + 1}`,
      cycle: 1,
    }));

    const count = await service.enqueueBatch(items, 5);
    expect(count).toBe(12);
    expect(addedJobs).toHaveLength(12);

    // Items 0..4: day 0 (delay < 24h)
    expect(addedJobs[0].opts.delay).toBe(0);
    expect(addedJobs[4].opts.delay).toBe(12000); // 4 * 3000ms

    // Items 5..9: day 1 (delay >= 24h)
    expect(addedJobs[5].opts.delay).toBe(24 * 60 * 60 * 1000);
    expect(addedJobs[9].opts.delay).toBe(24 * 60 * 60 * 1000 + 12000);

    // Items 10..11: day 2 (delay >= 48h)
    expect(addedJobs[10].opts.delay).toBe(48 * 60 * 60 * 1000);
  });

  it('processDispatchJob delivers request when within quotas', async () => {
    const reqDoc = {
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      profileId: new Types.ObjectId(),
      shortRef: 'CNC-12345678',
      status: 'queued',
      channel: 'email',
      save: jest.fn().mockResolvedValue(true),
    };
    mockRequests.findById.mockResolvedValue(reqDoc);

    const job = {
      id: 'job-1',
      data: {
        requestId: String(reqDoc._id),
        userId: String(reqDoc.userId),
        profileId: String(reqDoc.profileId),
      },
    };

    await service.processDispatchJob(job as any);
    expect(mockEngine.deliverClaimed).toHaveBeenCalledWith(reqDoc);
  });

  it('processDispatchJob reschedules for tomorrow if user daily quota is reached', async () => {
    mockMailQuota.canUserSendToday.mockResolvedValue({ allowed: false, reason: 'quota reached' });

    const reqDoc = {
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(),
      profileId: new Types.ObjectId(),
      shortRef: 'CNC-12345678',
      status: 'queued',
      channel: 'email',
      save: jest.fn().mockResolvedValue(true),
      nextAttemptAt: undefined,
    };
    mockRequests.findById.mockResolvedValue(reqDoc);

    const addedJobs: any[] = [];
    (service as any).queue = {
      add: jest.fn().mockImplementation((name, data, opts) => {
        addedJobs.push({ name, data, opts });
        return Promise.resolve({ id: opts.jobId });
      }),
    };

    const job = {
      id: 'job-1',
      data: {
        requestId: String(reqDoc._id),
        userId: String(reqDoc.userId),
        profileId: String(reqDoc.profileId),
      },
    };

    await service.processDispatchJob(job as any);
    expect(mockEngine.deliverClaimed).not.toHaveBeenCalled();
    expect(reqDoc.save).toHaveBeenCalled();
    expect(addedJobs).toHaveLength(1);
    expect(addedJobs[0].opts.delay).toBeGreaterThan(0);
  });
});
