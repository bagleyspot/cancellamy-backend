import './load-env'; // must stay first: some modules read the environment at import time
/** Entry point of `npm run openapi`: writes docs/openapi.json from the real application metadata. */
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app, { logger: false });
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Cancellamy API').setVersion('0.1.0').addBearerAuth().build(),
  );
  mkdirSync(join(process.cwd(), 'docs'), { recursive: true });
  writeFileSync(join(process.cwd(), 'docs', 'openapi.json'), JSON.stringify(doc, null, 2));
  await app.close();
}

void main();
