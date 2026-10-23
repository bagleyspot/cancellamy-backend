import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import { ProfileInputDto, SignAuthorizationDto, UpdateProfileDto } from './profile.dto';
import { ProfilesService } from './profiles.service';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.profiles.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: ProfileInputDto) {
    return this.profiles.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.profiles.get(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(user.id, id, dto);
  }

  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.profiles.remove(user.id, id);
  }

  @Get(':id/authorization/text')
  authorizationText(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.profiles.getAuthorizationText(user.id, id);
  }

  @Post(':id/authorization')
  sign(
    @CurrentUser() user: AuthUser,
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: SignAuthorizationDto,
    @Req() req: Request,
  ) {
    return this.profiles.sign(user.id, id, dto.signatureName, req.ip, req.get('user-agent'));
  }

  @Get(':id/authorization/pdf')
  async authorizationPdf(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string, @Res() res: Response) {
    const pdf = await this.profiles.authorizationPdf(user.id, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="delega-cancellamy.pdf"');
    res.send(pdf);
  }

  @HttpCode(204)
  @Delete(':id/authorization')
  revoke(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.profiles.revoke(user.id, id);
  }

  @HttpCode(200)
  @Post(':id/activate')
  activate(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.profiles.activate(user, id);
  }

  @HttpCode(200)
  @Post(':id/pause')
  pause(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.profiles.setPaused(user.id, id, true);
  }

  @HttpCode(200)
  @Post(':id/resume')
  resume(@CurrentUser() user: AuthUser, @Param('id', ObjectIdPipe) id: string) {
    return this.profiles.setPaused(user.id, id, false);
  }
}
