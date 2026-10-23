import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IsString, MaxLength } from 'class-validator';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Message, MessageDoc, Profile, ProfileDoc, RemovalRequest, RequestDoc, User, UserDoc } from '../db/schemas';
import { Roles } from '../auth/decorators';
import { CryptoService } from '../common/crypto.service';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { PaginationQuery, pageParams } from '../common/pagination';
import { InboundService } from '../inbound/inbound.service';

class AssignDto {
  @IsString() @MaxLength(24) requestId!: string;
}

@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDoc>,
    @InjectModel(Profile.name) private readonly profiles: Model<ProfileDoc>,
    @InjectModel(RemovalRequest.name) private readonly requests: Model<RequestDoc>,
    @InjectModel(Message.name) private readonly messages: Model<MessageDoc>,
    private readonly inbound: InboundService,
    private readonly crypto: CryptoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('stats')
  async stats() {
    const [users, profiles, activeProfiles, byStatus, messagesOut, messagesIn, unmatchedInbound] = await Promise.all([
      this.users.countDocuments(),
      this.profiles.countDocuments(),
      this.profiles.countDocuments({ status: 'active' }),
      this.requests.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      this.messages.countDocuments({ direction: 'out' }),
      this.messages.countDocuments({ direction: 'in' }),
      this.inbound.countUnmatched(),
    ]);
    return {
      users,
      profiles,
      activeProfiles,
      requestsByStatus: byStatus.map((s) => ({ status: s._id, count: s.count })),
      messagesOut,
      messagesIn,
      unmatchedInbound,
      mailMode: this.config.mailMode,
    };
  }

  @Get('inbound-unmatched')
  unmatched() {
    return this.inbound.listUnmatched();
  }

  @HttpCode(204)
  @Post('inbound-unmatched/:id/assign')
  async assign(@Param('id', ObjectIdPipe) id: string, @Body() dto: AssignDto): Promise<void> {
    await this.inbound.assign(id, dto.requestId);
  }

  @Get('outbox')
  async outbox(@Query() q: PaginationQuery) {
    const { page, limit, skip } = pageParams(q);
    const [items, total] = await Promise.all([
      this.messages.find({ direction: 'out' }).sort({ at: -1 }).skip(skip).limit(limit).lean(),
      this.messages.countDocuments({ direction: 'out' }),
    ]);
    return {
      items: items.map((m) => ({
        id: String(m._id),
        requestId: String(m.requestId),
        at: m.at.toISOString(),
        to: m.to,
        subject: this.crypto.decrypt(m.subjectEnc),
        dryRun: m.dryRun,
        providerId: m.providerId ?? null,
      })),
      total,
      page,
      limit,
    };
  }
}
