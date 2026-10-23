import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MailQuotaService } from './mail-quota.service';
import { MailQuota } from '../db/schemas';
import { Clock } from '../common/clock';
import { APP_CONFIG } from '../config/app-config';
import { Types } from 'mongoose';

describe('MailQuotaService', () => {
  let service: MailQuotaService;
  let clock: Clock;
  const store = new Map<string, { count: number; expiresAt: Date }>();

  const mockModel = {
    updateOne: jest.fn().mockImplementation((filter: { key: string }, update: { $inc?: { count?: number }; $setOnInsert?: { expiresAt?: Date } }) => {
      const existing = store.get(filter.key) ?? { count: 0, expiresAt: update.$setOnInsert?.expiresAt ?? new Date() };
      if (update.$inc?.count) existing.count += update.$inc.count;
      store.set(filter.key, existing);
      return Promise.resolve({ acknowledged: true });
    }),
    findOne: jest.fn().mockImplementation((filter: { key: string }) => ({
      lean: () => Promise.resolve(store.get(filter.key) ? { key: filter.key, count: store.get(filter.key)!.count } : null),
    })),
  };

  beforeEach(async () => {
    store.clear();
    clock = new Clock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailQuotaService,
        { provide: getModelToken(MailQuota.name), useValue: mockModel },
        { provide: Clock, useValue: clock },
        {
          provide: APP_CONFIG,
          useValue: {
            resendDailyLimit: 100,
            resendMonthlyLimit: 3000,
            resendSystemReserve: 5,
            userDailyRequestLimit: 5,
          },
        },
      ],
    }).compile();

    service = module.get<MailQuotaService>(MailQuotaService);
  });

  it('tracks Resend global daily and monthly quotas', async () => {
    await service.recordGlobalSend('resend');
    await service.recordGlobalSend('resend');
    await service.recordGlobalSend('smtp'); // non-resend does not consume resend quota

    const status = await service.getQuotaStatus();
    expect(status.resend.daily.used).toBe(2);
    expect(status.resend.monthly.used).toBe(2);
    expect(status.resend.daily.limit).toBe(100);
    expect(status.resend.monthly.limit).toBe(3000);
  });

  it('pauses automated emails when daily threshold is reached, reserving space for system emails', async () => {
    // Fill up to 95 (100 - 5 reserve)
    for (let i = 0; i < 95; i++) {
      await service.recordGlobalSend('resend');
    }

    // Automated batch sends (isSystem=false) should be paused
    const autoCheck = await service.canSendGlobal('resend', false);
    expect(autoCheck.allowed).toBe(false);
    expect(autoCheck.reason).toContain('Quota giornaliera per invio automatico raggiunta');

    // System emails (isSystem=true) should still be allowed
    const systemCheck = await service.canSendGlobal('resend', true);
    expect(systemCheck.allowed).toBe(true);

    // Send 5 system emails up to 100
    for (let i = 0; i < 5; i++) {
      await service.recordGlobalSend('resend');
    }

    // Now even system emails are blocked at the hard cap of 100
    const hardCapCheck = await service.canSendGlobal('resend', true);
    expect(hardCapCheck.allowed).toBe(false);
    expect(hardCapCheck.reason).toContain('Quota giornaliera Resend raggiunta');
  });

  it('blocks all sends when monthly quota of 3000 is reached', async () => {
    const monthKey = `resend:monthly:${clock.now().toISOString().slice(0, 7)}`;
    store.set(monthKey, { count: 3000, expiresAt: new Date() });

    const check = await service.canSendGlobal('resend', false);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('Quota mensile Resend raggiunta');
  });

  it('enforces fair-share maximum 5 automated requests per user per day', async () => {
    const userId = new Types.ObjectId();

    // User has 0 sends initially
    expect(await service.getUserDailySent(userId)).toBe(0);
    expect((await service.canUserSendToday(userId)).allowed).toBe(true);

    // Record 5 sends for this user
    for (let i = 0; i < 5; i++) {
      await service.recordUserSend(userId);
    }

    expect(await service.getUserDailySent(userId)).toBe(5);
    const check = await service.canUserSendToday(userId);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('Quota giornaliera utente raggiunta (5/5');

    // Advancing to tomorrow resets the count
    clock.advance(24 * 60 * 60 * 1000 + 1000);
    expect(await service.getUserDailySent(userId)).toBe(0);
    expect((await service.canUserSendToday(userId)).allowed).toBe(true);
  });
});
