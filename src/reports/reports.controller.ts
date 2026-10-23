import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ReportsService } from './reports.service';

class ReportsQuery {
  @IsOptional() @IsString() @MaxLength(24) profileId?: string;
}

class GenerateReportDto {
  @IsString() @MaxLength(24) profileId!: string;
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ReportsQuery) {
    return this.reports.list(user.id, q.profileId);
  }

  @Post('generate')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateReportDto) {
    return this.reports.generateForUser(user.id, dto.profileId);
  }
}
