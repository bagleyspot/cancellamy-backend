import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class SmtpInputDto {
  @IsString() @IsNotEmpty() @MaxLength(253) @Matches(/^[A-Za-z0-9.-]+$/, { message: 'host must be a hostname or an IP address' }) host!: string;
  @IsInt() @Min(1) @Max(65535) port!: number;
  @IsBoolean() secure!: boolean;
  @IsString() @IsNotEmpty() @MaxLength(254) username!: string;
  @IsString() @IsNotEmpty() @MaxLength(256) password!: string;
  @IsEmail() @MaxLength(254) fromAddress!: string;
}

export class SetSenderDto {
  @IsIn(['cancellamy', 'smtp']) mode!: 'cancellamy' | 'smtp';
  @IsOptional() @ValidateNested() @Type(() => SmtpInputDto) smtp?: SmtpInputDto;
}

export class TestSenderDto {
  @IsOptional() @ValidateNested() @Type(() => SmtpInputDto) smtp?: SmtpInputDto;
}

export class CompleteGmailDto {
  @IsString() @IsNotEmpty() @MaxLength(2048) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(4096) state!: string;
}
