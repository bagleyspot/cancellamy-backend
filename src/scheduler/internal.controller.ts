import { Controller, HttpCode, Inject, Headers, NotFoundException, Post, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { Public } from '../auth/decorators';
import { safeEqual } from '../common/crypto.service';
import { SchedulerService } from './scheduler.service';

/** Entry point for Cloud Scheduler (CPU is throttled between requests on Cloud Run). */
@Controller('internal/cron')
export class InternalController {
  constructor(
    private readonly scheduler: SchedulerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('tick')
  async tick(@Headers('x-cron-secret') secret?: string) {
    if (!this.config.cronSecret) throw new NotFoundException();
    if (!secret || !safeEqual(secret, this.config.cronSecret)) throw new UnauthorizedException();
    return this.scheduler.tick();
  }
}
