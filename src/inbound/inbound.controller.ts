import { Controller, HttpCode, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { InboundService } from './inbound.service';

@Controller('webhooks')
export class InboundController {
  constructor(private readonly inbound: InboundService) {}

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post('resend')
  async resend(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
    await this.inbound.handleResendWebhook(req.rawBody, req.headers);
    return { received: true };
  }
}
