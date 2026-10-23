import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthUser } from '../auth/auth.types';
import { ChangePasswordDto, DeleteAccountDto, UpdateMeDto } from '../auth/auth.dto';
import { AuthService, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators';
import { UsersService } from './users.service';

@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.updateSettings(user.id, dto.settings);
  }

  @HttpCode(204)
  @Post('change-password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: Request): Promise<void> {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const family = await this.auth.familyOf(cookies?.[REFRESH_COOKIE]);
    await this.users.changePassword(user.id, dto.currentPassword, dto.newPassword, family);
  }

  @Get('export')
  async export(@CurrentUser() user: AuthUser, @Res() res: Response): Promise<void> {
    const data = await this.users.exportData(user.id);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cancellamy-export.json"');
    res.send(JSON.stringify(data, null, 2));
  }

  @HttpCode(204)
  @Delete()
  async remove(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.users.deleteAccount(user.id, dto.password);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }
}
