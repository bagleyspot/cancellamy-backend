import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Feature } from '../common/feature.guard';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { NuisanceComplaintDto, NuisanceQuery, NuisanceReportDto } from './nuisance.dto';
import { NuisanceService } from './nuisance.service';

@Feature('nuisance')
@Controller('nuisance')
export class NuisanceController {
  constructor(private readonly nuisance: NuisanceService) {}

  @Get()
  overview(@CurrentUser() user: AuthUser, @Query() q: NuisanceQuery) {
    return this.nuisance.overview(user.id, q.profileId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: NuisanceReportDto) {
    return this.nuisance.create(user.id, dto);
  }

  @HttpCode(200)
  @Post('complaint')
  complaint(@CurrentUser() user: AuthUser, @Body() dto: NuisanceComplaintDto) {
    return this.nuisance.complaint(user.id, dto.profileId, dto.reportIds);
  }

  @Get('complaint.pdf')
  async complaintPdf(@CurrentUser() user: AuthUser, @Query() q: NuisanceQuery, @Res() res: Response) {
    const pdf = await this.nuisance.complaintPdf(user.id, q.profileId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="segnalazione-garante.pdf"');
    res.send(pdf);
  }

  @HttpCode(204)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string): Promise<void> {
    await this.nuisance.remove(user.id, id);
  }
}
