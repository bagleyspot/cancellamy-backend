import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { Feature } from '../common/feature.guard';
import { LeaderboardService, LeaderboardSort } from '../leaderboard/leaderboard.service';
import { APP_CONFIG, AppConfig, computeFeatures } from '../config/app-config';
import { Public, Roles } from '../auth/decorators';
import { BrokersService } from './brokers.service';
import { BrokerVerifierService } from './broker-verifier.service';
import { AdminBrokerPatchDto, AutoVerifyBrokersDto, BROKER_CATEGORIES, BrokersQuery } from './brokers.dto';
import { loadRegistryFile } from './registry';

class LeaderboardQuery {
  @IsOptional() @IsIn(['responseRate', 'completionRate', 'refusalRate', 'medianDaysToFirstReply', 'users']) sort?: LeaderboardSort;
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
  @IsOptional() @IsIn(BROKER_CATEGORIES as readonly string[]) category?: string;
}

@Controller()
export class BrokersController {
  constructor(
    private readonly brokers: BrokersService,
    private readonly verifier: BrokerVerifierService,
    private readonly leaderboard: LeaderboardService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('config')
  async publicConfig() {
    const counts = await this.brokers.count();
    return {
      mailMode: this.config.mailMode,
      features: computeFeatures(this.config),
      leaderboardMinUsers: this.config.leaderboardMinUsers,
      attachmentRetentionDays: this.config.attachmentRetentionDays,
      maxProfiles: this.config.maxProfilesPerUser,
      customRequestsPerMonth: this.config.customRequestsPerMonth,
      appVersion: this.config.appVersion,
      supportEmail: this.config.supportEmail,
      registryEntries: counts.total,
      sendableBrokers: counts.sendable,
    };
  }

  @Public()
  @Get('brokers')
  list(@Query() q: BrokersQuery) {
    return this.brokers.list(q);
  }

  @Public()
  @Get('brokers/stats')
  stats() {
    return this.brokers.stats();
  }

  @Public()
  @Feature('leaderboard')
  @Get('brokers/leaderboard')
  board(@Query() q: LeaderboardQuery) {
    return this.leaderboard.get(q);
  }

  @Public()
  @Get('brokers/:id')
  get(@Param('id') id: string) {
    return this.brokers.get(id);
  }

  @Roles('admin')
  @Get('admin/brokers')
  adminList(@Query() q: BrokersQuery) {
    return this.brokers.list(q);
  }

  @Roles('admin')
  @Patch('admin/brokers/:id')
  adminPatch(@Param('id') id: string, @Body() dto: AdminBrokerPatchDto) {
    return this.brokers.adminPatch(id, dto);
  }

  @Roles('admin')
  @Post('admin/brokers/reseed')
  reseed() {
    return this.brokers.seed(loadRegistryFile(this.config.registryPath));
  }

  @Roles('admin')
  @Post('admin/brokers/auto-verify')
  autoVerify(@Body() dto: AutoVerifyBrokersDto) {
    return this.verifier.autoVerifyAll({ crawlWebsites: dto?.crawlWebsites });
  }
}
