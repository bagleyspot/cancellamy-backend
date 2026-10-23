import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Feature } from '../common/feature.guard';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { DelistingInputDto, DelistingPatchDto, DelistingQuery } from './delistings.dto';
import { DelistingsService } from './delistings.service';

@Feature('delisting')
@Controller('delistings')
export class DelistingsController {
  constructor(private readonly delistings: DelistingsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: DelistingQuery) {
    return this.delistings.list(user.id, q);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: DelistingInputDto) {
    return this.delistings.create(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.delistings.get(user.id, id);
  }

  @Get(':id/guide')
  guide(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.delistings.guide(user.id, id);
  }

  @Patch(':id')
  patch(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string, @Body() dto: DelistingPatchDto) {
    return this.delistings.patch(user.id, id, dto);
  }

  @HttpCode(204)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string): Promise<void> {
    await this.delistings.remove(user.id, id);
  }
}
