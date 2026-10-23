import { Global, Logger, Module, OnApplicationBootstrap, Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { BrokersController } from './brokers.controller';
import { BrokersService } from './brokers.service';
import { BrokerVerifierService } from './broker-verifier.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { loadRegistryFile } from './registry';

@Global()
@Module({
  controllers: [BrokersController],
  providers: [BrokersService, BrokerVerifierService, LeaderboardService],
  exports: [BrokersService, BrokerVerifierService, LeaderboardService],
})
export class BrokersModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(BrokersModule.name);

  constructor(
    private readonly brokers: BrokersService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.seedOnBoot) return;
    try {
      await this.brokers.seed(loadRegistryFile(this.config.registryPath));
    } catch (err) {
      // A broken registry file must not stop the API from serving; the error is loud in the logs.
      this.logger.error(`registry seed failed: ${(err as Error).message}`);
    }
  }
}
