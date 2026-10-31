import { ArrayMaxSize, IsArray, IsIn, IsISO8601, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class NuisanceReportDto {
  @IsMongoId() profileId!: string;
  @IsIn(['call', 'sms', 'messaging', 'email', 'post']) channel!: string;
  @IsOptional() @IsString() @MaxLength(60) callerNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) company?: string;
  @IsISO8601({ strict: true }) receivedAt!: string;
  @IsOptional() @IsString() @MaxLength(500) summary?: string;
  @IsOptional() @IsIn(['no', 'unknown']) consentGiven?: 'no' | 'unknown';
}

export class NuisanceQuery {
  @IsMongoId() profileId!: string;
}

export class NuisanceComplaintDto {
  @IsMongoId() profileId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(24, { each: true }) reportIds?: string[];
}
