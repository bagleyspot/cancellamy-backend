import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Feature } from '../common/feature.guard';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { CompleteGmailDto, SetSenderDto, TestSenderDto } from './sender.dto';
import { SenderService } from './sender.service';

@Feature('sender')
@Controller('profiles/:id/sender')
export class SenderController {
  constructor(private readonly sender: SenderService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.sender.get(user.id, id);
  }

  @Put()
  set(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string, @Body() dto: SetSenderDto) {
    return this.sender.set(user.id, id, dto);
  }

  @HttpCode(200)
  @Post('test')
  test(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string, @Body() dto: TestSenderDto) {
    return this.sender.test(user.id, id, dto.smtp);
  }

  @HttpCode(200)
  @Post('gmail/start')
  startGmail(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.sender.startGmail(user.id, id);
  }

  @Delete()
  remove(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.sender.remove(user.id, id);
  }
}

/** The app (not the browser redirect) completes the OAuth flow, so the normal Bearer authentication applies. */
@Feature('sender')
@Controller('sender/gmail')
export class GmailAuthController {
  constructor(private readonly sender: SenderService) {}

  @HttpCode(200)
  @Post('complete')
  complete(@CurrentUser() user: AuthUser, @Body() dto: CompleteGmailDto) {
    return this.sender.completeGmail(user.id, dto);
  }
}
