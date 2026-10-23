import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Notification, NotificationDoc, User, UserDoc } from '../db/schemas';
import { MailService } from '../mail/mail.service';
import { Paginated, pageParams } from '../common/pagination';

export interface NotificationDtoShape {
  id: string;
  type: string;
  title: string;
  body: string;
  requestId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotifyInput {
  type: 'request_status' | 'action_required' | 'report' | 'system';
  title: string;
  body: string;
  requestId?: string | Types.ObjectId;
  /** Link opened by the email button (path inside the web app). */
  appPath?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name) private readonly notifications: Model<NotificationDoc>,
    @InjectModel(User.name) private readonly users: Model<UserDoc>,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async notify(userId: string | Types.ObjectId, input: NotifyInput): Promise<void> {
    const uid = new Types.ObjectId(String(userId));
    await this.notifications.create({
      userId: uid,
      type: input.type,
      title: input.title,
      body: input.body,
      requestId: input.requestId ? new Types.ObjectId(String(input.requestId)) : undefined,
    });
    const user = await this.users.findById(uid).select('email emailVerifiedAt settings').lean();
    if (!user || !user.emailVerifiedAt || user.settings?.notifyByEmail === false) return;
    try {
      await this.mail.sendSystem({
        to: user.email,
        subject: input.title,
        paragraphs: [input.body],
        button: { label: 'Apri Cancellamy', url: `${this.config.appUrl}${input.appPath ?? '/app'}` },
      });
    } catch (err) {
      this.logger.warn(`notification email failed: ${(err as Error).message}`);
    }
  }

  async list(userId: string, q: { unread?: boolean; page?: number; limit?: number }): Promise<Paginated<NotificationDtoShape>> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (q.unread) filter.readAt = { $exists: false };
    const { page, limit, skip } = pageParams(q);
    const [items, total] = await Promise.all([
      this.notifications.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.notifications.countDocuments(filter),
    ]);
    return {
      items: items.map((n) => ({
        id: String(n._id),
        type: n.type,
        title: n.title,
        body: n.body,
        requestId: n.requestId ? String(n.requestId) : null,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.notifications.countDocuments({ userId: new Types.ObjectId(userId), readAt: { $exists: false } });
  }

  async markRead(userId: string, ids?: string[]): Promise<void> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId), readAt: { $exists: false } };
    if (ids?.length) filter._id = { $in: ids.filter((i) => /^[a-f0-9]{24}$/i.test(i)).map((i) => new Types.ObjectId(i)) };
    await this.notifications.updateMany(filter, { $set: { readAt: new Date() } });
  }
}
