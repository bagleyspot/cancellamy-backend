import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard, RolesGuard } from './auth/guards';
import { BrokersModule } from './brokers/brokers.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { FeatureGuard } from './common/feature.guard';
import { APP_CONFIG, AppConfig, AppConfigModule } from './config/app-config';
import { DbModule } from './db/db.module';
import { DomainModule } from './domain.module';
import { HealthController } from './health/health.controller';
import { MailModule } from './mail/mail.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.nodeEnv === 'test' ? 'silent' : config.logLevel,
          // Cloud Logging reads `severity`; keep the numeric level too.
          formatters: { level: (label: string, number: number) => ({ severity: label.toUpperCase(), level: number }) },
          messageKey: 'message',
          timestamp: stdTimeFunctions.isoTime,
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          autoLogging: { ignore: (req: { url?: string }) => req.url === '/health' || req.url === '/health/ready' },
          serializers: {
            req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split('?')[0] }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
        },
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ uri: config.mongoUri, maxPoolSize: 10, serverSelectionTimeoutMS: 10_000 }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ throttlers: [{ ttl: 60_000, limit: config.throttleLimit }] }),
    }),
    DbModule,
    MailModule,
    AuthModule,
    BrokersModule,
    DomainModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
