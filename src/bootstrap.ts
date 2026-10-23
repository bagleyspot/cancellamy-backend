import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, AppConfig } from './config/app-config';

/** Shared HTTP setup so the real server and the e2e tests behave identically. */
export function configureApp(app: INestApplication, opts: { logger?: boolean } = {}): void {
  const config = app.get<AppConfig>(APP_CONFIG);
  const express = app as NestExpressApplication;
  if (config.trustProxy) express.set('trust proxy', 1);
  express.disable('x-powered-by');
  if (opts.logger !== false) app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready', 'internal/cron/tick'] });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication): void {
  const doc = new DocumentBuilder()
    .setTitle('Cancellamy API')
    .setDescription('Free open-source GDPR data-removal service for Italy')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc), { jsonDocumentUrl: 'api/docs-json' });
}
