import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { AccessFindingsDto, CreateAccessRequestsDto, CustomRequestDto, ListRequestsQuery, OutcomeDto, ProvideIdDto, SendRequestsDto, SimulateReplyDto, SummaryQuery } from './requests.dto';
import { Feature } from '../common/feature.guard';
import { DossierService } from '../dossier/dossier.service';
import { RequestsService } from './requests.service';

@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly dossier: DossierService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListRequestsQuery) {
    return this.requests.list(user.id, q);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Query() q: SummaryQuery) {
    return this.requests.summary(user.id, q.profileId);
  }

  @Post('custom')
  custom(@CurrentUser() user: AuthUser, @Body() dto: CustomRequestDto) {
    return this.requests.createCustom(user, dto);
  }

  /** Manual selection: queues the chosen drafts (at most 10 per call). */
  @HttpCode(200)
  @Post('send')
  send(@CurrentUser() user: AuthUser, @Body() dto: SendRequestsDto) {
    return this.requests.sendSelected(user.id, dto);
  }

  @Feature('access')
  @Post('access')
  access(@CurrentUser() user: AuthUser, @Body() dto: CreateAccessRequestsDto) {
    return this.requests.createAccess(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.requests.getDetail(user.id, id);
  }

  @HttpCode(200)
  @Post(':id/mark-done')
  markDone(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.requests.markDone(user.id, id);
  }

  @HttpCode(200)
  @Post(':id/outcome')
  outcome(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string, @Body() dto: OutcomeDto) {
    return this.requests.outcome(user.id, id, dto);
  }

  @HttpCode(200)
  @Post(':id/provide-id')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  provideId(
    @CurrentUser() user: AuthUser,
    @Param('id', ObjectIdPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ProvideIdDto,
  ) {
    return this.requests.provideId(user.id, id, file, dto.note);
  }

  @HttpCode(200)
  @Post(':id/reminder')
  reminder(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.requests.remind(user.id, id);
  }

  @HttpCode(200)
  @Post(':id/escalate')
  escalate(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.requests.escalate(user.id, id);
  }

  @Feature('dossier')
  @Get(':id/dossier.zip')
  async dossierZip(
    @CurrentUser() user: AuthUser,
    @Param('id', ObjectIdPipe) id: string,
    @Query('timestamp') timestamp: string | undefined,
    @Res() res: Response,
  ) {
    const file = await this.dossier.build(user.id, id, timestamp === 'true');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.data);
  }

  @Get(':id/complaint.pdf')
  async complaintPdf(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string, @Res() res: Response) {
    const pdf = await this.requests.complaintPdf(user.id, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="reclamo-garante.pdf"');
    res.send(pdf);
  }

  @Put(':id/findings')
  findings(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string, @Body() dto: AccessFindingsDto) {
    return this.requests.recordFindings(user.id, id, dto);
  }

  @Get(':id/messages/:messageId/attachments/:attachmentId')
  async attachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ObjectIdPipe) id: string,
    @Param('messageId', ObjectIdPipe) messageId: string,
    @Param('attachmentId', ObjectIdPipe) attachmentId: string,
    @Res() res: Response,
  ) {
    const file = await this.requests.attachment(user.id, id, messageId, attachmentId);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.send(file.data);
  }

  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.requests.cancel(user.id, id);
  }

  @HttpCode(200)
  @Post(':id/simulate-reply')
  simulate(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string, @Body() dto: SimulateReplyDto) {
    return this.requests.simulateReply(user.id, id, dto);
  }
}
