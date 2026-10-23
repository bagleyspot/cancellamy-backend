import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ConfirmCodeDto, SendCodeDto } from './identity.dto';
import { IdentityService } from './identity.service';

@Controller('profiles/:id/identity')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.identity.get(user.id, id);
  }

  @HttpCode(204)
  @Post('send-code')
  async sendCode(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string, @Body() dto: SendCodeDto): Promise<void> {
    await this.identity.sendCode(user.id, id, dto.type, dto.value);
  }

  @HttpCode(200)
  @Post('confirm')
  confirm(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string, @Body() dto: ConfirmCodeDto) {
    return this.identity.confirm(user.id, id, dto.type, dto.value, dto.code);
  }
}
