import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Feature } from '../common/feature.guard';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { SetSenderDto, TestSenderDto } from './sender.dto';
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

  @Delete()
  remove(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.sender.remove(user.id, id);
  }
}
