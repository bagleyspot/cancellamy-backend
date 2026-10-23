import { Controller, Get, Param } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Feature } from '../common/feature.guard';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { RequestsService } from './requests.service';

@Feature('access')
@Controller('profiles/:id/data-map')
export class DataMapController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  map(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.requests.dataMap(user.id, id);
  }
}
