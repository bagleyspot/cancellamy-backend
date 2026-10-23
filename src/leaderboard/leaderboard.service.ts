import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Broker, BrokerDoc, RemovalRequest, RequestDoc } from '../db/schemas';
import { Clock, DAY_MS } from '../common/clock';

export type LeaderboardSort = 'responseRate' | 'completionRate' | 'refusalRate' | 'medianDaysToFirstReply' | 'users';

export interface Performance {
  broker: { id: string; name: string; website: string | null; category: string };
  requests: number;
  users: number;
  responseRate: number;
  completionRate: number;
  refusalRate: number;
  overdueRate: number;
  medianDaysToFirstReply: number | null;
  medianDaysToCompletion: number | null;
}

interface Row {
  userId: string;
  status: string;
  sentAt: Date;
  dueAt?: Date;
  firstReplyAt?: Date;
  completedAt?: Date;
}

const CACHE_MS = 10 * 60 * 1000;
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return Math.round(value * 10) / 10;
};
const rate = (n: number, d: number) => (d ? Math.round((n / d) * 100) / 100 : 0);

/**
 * Public, aggregate statistics per broker. A broker appears only when enough distinct users contributed
 * (privacy threshold); simulations (dry-run) never count.
 */
@Injectable()
export class LeaderboardService {
  private cache?: { at: number; items: Performance[]; hidden: number };

  constructor(
    @InjectModel(RemovalRequest.name) private readonly requests: Model<RequestDoc>,
    @InjectModel(Broker.name) private readonly brokers: Model<BrokerDoc>,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Test helper and admin tool: forget the cached aggregation. */
  invalidate(): void {
    this.cache = undefined;
  }

  private async compute(): Promise<{ items: Performance[]; hidden: number }> {
    const now = this.clock.now();
    const rows = await this.requests
      .find({ kind: { $ne: 'access' }, dryRun: false, sentAt: { $exists: true }, brokerKey: { $not: /^custom:/ } })
      .select('brokerKey userId status sentAt dueAt firstReplyAt completedAt')
      .lean();
    const byBroker = new Map<string, Row[]>();
    for (const r of rows) {
      const list = byBroker.get(r.brokerKey) ?? [];
      list.push({ userId: String(r.userId), status: r.status, sentAt: r.sentAt as Date, dueAt: r.dueAt, firstReplyAt: r.firstReplyAt, completedAt: r.completedAt });
      byBroker.set(r.brokerKey, list);
    }
    const brokers = await this.brokers.find({ sendEnabled: true }).select('slug name website category').lean();
    const items: Performance[] = [];
    let hidden = 0;
    for (const b of brokers) {
      const all = byBroker.get(b.slug) ?? [];
      // Only requests old enough to have had a fair chance to be answered (or already answered) are measured.
      const eligible = all.filter((r) => r.sentAt.getTime() <= now.getTime() - 30 * DAY_MS || !!r.firstReplyAt || r.status === 'completed' || r.status === 'refused');
      const users = new Set(eligible.map((r) => r.userId)).size;
      if (users < this.config.leaderboardMinUsers) {
        hidden += 1;
        continue;
      }
      const n = eligible.length;
      const answered = eligible.filter((r) => r.firstReplyAt);
      items.push({
        broker: { id: b.slug, name: b.name, website: b.website ?? null, category: b.category },
        requests: n,
        users,
        responseRate: rate(answered.length, n),
        completionRate: rate(eligible.filter((r) => r.status === 'completed').length, n),
        refusalRate: rate(eligible.filter((r) => r.status === 'refused').length, n),
        overdueRate: rate(eligible.filter((r) => !r.firstReplyAt && r.dueAt && r.dueAt <= now).length, n),
        medianDaysToFirstReply: median(answered.map((r) => ((r.firstReplyAt as Date).getTime() - r.sentAt.getTime()) / DAY_MS)),
        medianDaysToCompletion: median(
          eligible.filter((r) => r.status === 'completed' && r.completedAt).map((r) => ((r.completedAt as Date).getTime() - r.sentAt.getTime()) / DAY_MS),
        ),
      });
    }
    return { items, hidden };
  }

  async get(opts: { sort?: LeaderboardSort; order?: 'asc' | 'desc'; category?: string } = {}) {
    const nowMs = Date.now();
    if (!this.cache || nowMs - this.cache.at > CACHE_MS) {
      const c = await this.compute();
      this.cache = { at: nowMs, ...c };
    }
    const sort = opts.sort ?? 'responseRate';
    const dir = opts.order === 'asc' ? 1 : -1;
    let items = this.cache.items;
    if (opts.category) items = items.filter((i) => i.broker.category === opts.category);
    const value = (p: Performance): number => {
      const v = p[sort];
      return v === null ? (dir === -1 ? -Infinity : Infinity) : v;
    };
    items = [...items].sort((a, b) => (value(a) - value(b)) * dir || a.broker.name.localeCompare(b.broker.name));
    return { minUsers: this.config.leaderboardMinUsers, generatedAt: new Date(this.cache.at).toISOString(), items, hiddenBrokers: this.cache.hidden };
  }
}
