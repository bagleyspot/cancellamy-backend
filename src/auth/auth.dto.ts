import { Equals, IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class RegisterDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
  @Equals(true, { message: 'acceptTerms must be true' }) acceptTerms!: true;
}

export class LoginDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) password!: string;
}

export class TokenDto {
  @IsString() @IsNotEmpty() @MaxLength(200) token!: string;
}

export class ForgotPasswordDto {
  @IsEmail() @MaxLength(254) email!: string;
}

export class ResetPasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(200) token!: string;
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(10) @MaxLength(128) newPassword!: string;
}

export class SettingsPatchDto {
  @IsOptional() @IsBoolean() notifyByEmail?: boolean;
  @IsOptional() @IsBoolean() monthlyReport?: boolean;
}

export class UpdateMeDto {
  @ValidateNested() @Type(() => SettingsPatchDto) settings!: SettingsPatchDto;
}

export class DeleteAccountDto {
  @IsString() @IsNotEmpty() @MaxLength(128) password!: string;
}
