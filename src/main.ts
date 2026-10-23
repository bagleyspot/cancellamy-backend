import './load-env'; // must stay first: some modules read the environment at import time
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';
import { APP_CONFIG, AppConfig } from './config/app-config';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  configureApp(app);
  const config = app.get<AppConfig>(APP_CONFIG);
  if (config.nodeEnv !== 'production') setupSwagger(app);
  // Cloud Run provides PORT; listen on all interfaces.
  await app.listen(config.port, '0.0.0.0');
}

void main();
