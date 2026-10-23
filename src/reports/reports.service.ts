import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Clock } from '../common/clock';
import { Profile, ProfileDoc, RemovalRequest, Report, ReportDoc, RequestDoc, User, UserDoc } from '../db/schemas';
import { NotificationsService } from '../notifications/notifications.service';
import { ProfileDataService } from '../profiles/profile-data.service';

export interface ReportDtoShape {
  id: string;
  profileId: string;
  period: string;
  createdAt: string;
  stats: { sent: number; completed: number; refused: number; actionRequired: number; overdue: number; newlyCovered: number };
  highlights: string[];
}

function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function bounds(period: string): { from: Date; to: Date } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(Report.name) private readonly reports: Model<ReportDoc>,
    @InjectModel(RemovalRequest.name) private readonly requests: Model<RequestDoc>,
    @InjectModel(Profile.name) private readonly profiles: Model<ProfileDoc>,
    @InjectModel(User.name) private readonly users: Model<UserDoc>,
    private readonly data: ProfileDataService,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  private toDto(r: ReportDoc | (Report & { _id: Types.ObjectId })): ReportDtoShape {
    return {
      id: String(r._id),
      profileId: String(r.profileId),
      period: r.period,
      createdAt: r.createdAt.toISOString(),
      stats: {
        sent: r.stats.sent,
        completed: r.stats.completed,
        refused: r.stats.refused,
        actionRequired: r.stats.actionRequired,
        overdue: r.stats.overdue,
        newlyCovered: r.stats.newlyCovered,
      },
      highlights: r.highlights,
    };
  }

  async list(userId: string, profileId?: string): Promise<ReportDtoShape[]> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (profileId) filter.profileId = new Types.ObjectId(profileId);
    const items = await this.reports.find(filter).sort({ period: -1, createdAt: -1 }).limit(120);
    return items.map((r) => this.toDto(r));
  }

  async generateForUser(userId: string, profileId: string, period = periodOf(this.clock.now())): Promise<ReportDtoShape> {
    const profile = await this.data.getOwned(userId, profileId);
    return this.build(profile, period);
  }

  /** Computes and upserts the report of a profile for a YYYY-MM period. */
  async build(profile: ProfileDoc, period: string): Promise<ReportDtoShape> {
    const { from, to } = bounds(period);
    const base = { profileId: profile._id, kind: { $ne: 'access' as const } };
    const [sent, completed, refused, actionRequired, overdue, newlyCovered, completedNames] = await Promise.all([
      this.requests.countDocuments({ ...base, sentAt: { $gte: from, $lt: to } }),
      this.requests.countDocuments({ ...base, completedAt: { $gte: from, $lt: to } }),
      this.requests.countDocuments({ ...base, status: 'refused', lastActivityAt: { $gte: from, $lt: to } }),
      this.requests.countDocuments({ ...base, status: 'action_required' }),
      this.requests.countDocuments({ ...base, status: 'overdue' }),
      this.requests.countDocuments({ ...base, createdAt: { $gte: from, $lt: to } }),
      this.requests.find({ ...base, completedAt: { $gte: from, $lt: to } }).select('brokerName').limit(5).lean(),
    ]);
    const highlights: string[] = [];
    if (completed) highlights.push(`${completed} ${completed === 1 ? 'richiesta completata' : 'richieste completate'}${completedNames.length ? `: ${completedNames.map((n) => n.brokerName).join(', ')}${completed > completedNames.length ? '…' : ''}` : ''}.`);
    if (sent) highlights.push(`${sent} ${sent === 1 ? 'richiesta inviata' : 'richieste inviate'} nel mese.`);
    if (actionRequired) highlights.push(`${actionRequired} ${actionRequired === 1 ? 'azione richiede' : 'azioni richiedono'} il tuo intervento.`);
    if (overdue) highlights.push(`${overdue} ${overdue === 1 ? 'richiesta è scaduta' : 'richieste sono scadute'} senza risposta: valuta un reclamo al Garante.`);
    if (!highlights.length) highlights.push('Nessuna novità questo mese.');
    const doc = await this.reports.findOneAndUpdate(
      { profileId: profile._id, period },
      { $set: { userId: profile.userId, stats: { sent, completed, refused, actionRequired, overdue, newlyCovered }, highlights } },
      { upsert: true, new: true },
    );
    return this.toDto(doc);
  }

  /** Scheduler task: previous-month report for active profiles of users who enabled it. */
  async generateMonthly(limit: number): Promise<number> {
    const now = this.clock.now();
    const prev = periodOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
    const profiles = await this.profiles.find({ status: { $in: ['active', 'paused'] } }).sort({ _id: 1 });
    let created = 0;
    for (const p of profiles) {
      if (created >= limit) break;
      if (await this.reports.exists({ profileId: p._id, period: prev })) continue;
      const user = await this.users.findById(p.userId).select('settings').lean();
      if (!user || user.settings?.monthlyReport === false) continue;
      const report = await this.build(p, prev);
      created += 1;
      await this.notifications.notify(p.userId, {
        type: 'report',
        title: `Il tuo report di ${prev}`,
        body: report.highlights.join(' '),
        appPath: '/app/report',
      });
    }
    return created;
  }
}
