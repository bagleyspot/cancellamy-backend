import { IsArray, IsIn, IsISO8601, IsOptional, IsString, MaxLength, ArrayMaxSize } from 'class-validator';

export class NuisanceReportDto {
  @IsString() @MaxLength(24) profileId!: string;
  @IsIn(['call', 'sms', 'messaging', 'email', 'post']) channel!: string;
  @IsOptional() @IsString() @MaxLength(60) callerNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) company?: string;
  @IsISO8601({ strict: true }) receivedAt!: string;
  @IsOptional() @IsString() @MaxLength(500) summary?: string;
  @IsOptional() @IsIn(['no', 'unknown']) consentGiven?: 'no' | 'unknown';
}

export class NuisanceQuery {
  @IsString() @MaxLength(24) profileId!: string;
}

export class NuisanceComplaintDto {
  @IsString() @MaxLength(24) profileId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(24, { each: true }) reportIds?: string[];
}
