import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { BreachesService } from './breaches.service';

@Controller('profiles/:id/breaches')
export class BreachesController {
  constructor(private readonly breaches: BreachesService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.breaches.summary(user.id, id);
  }

  @HttpCode(202)
  @Post('check')
  check(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.breaches.checkNow(user.id, id);
  }
}
