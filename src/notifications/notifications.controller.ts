import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { PaginationQuery } from '../common/pagination';
import { NotificationsService } from './notifications.service';

class NotificationsQuery extends PaginationQuery {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unread?: boolean;
}

class MarkReadDto {
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @Type(() => String) ids?: string[];
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: NotificationsQuery) {
    return this.notifications.list(user.id, q);
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: AuthUser) {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @HttpCode(204)
  @Post('read')
  async read(@CurrentUser() user: AuthUser, @Body() dto: MarkReadDto): Promise<void> {
    await this.notifications.markRead(user.id, dto.ids);
  }
}
