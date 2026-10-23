import { IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { PaginationQuery } from '../common/pagination';

export const ENGINES = ['google', 'bing', 'other'] as const;
export const REASON_KEYS = ['outdated', 'irrelevant', 'inaccurate', 'excessive', 'no_public_interest', 'other'] as const;
export const DELISTING_STATUSES = ['to_submit', 'submitted', 'approved', 'partially_approved', 'denied', 'appealed', 'cancelled'] as const;

export class DelistingInputDto {
  @IsString() @MaxLength(24) profileId!: string;
  @IsIn(ENGINES as readonly string[]) engine!: 'google' | 'bing' | 'other';
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }) @MaxLength(2000) url!: string;
  @IsOptional() @IsString() @MaxLength(200) searchQuery?: string;
  @IsIn(REASON_KEYS as readonly string[]) reason!: string;
  @IsOptional() @IsString() @MaxLength(2000) explanation?: string;
}

export class DelistingPatchDto {
  @IsOptional() @IsIn(DELISTING_STATUSES as readonly string[]) status?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsString() @MaxLength(2000) explanation?: string;
}

export class DelistingQuery extends PaginationQuery {
  @IsOptional() @IsString() @MaxLength(24) profileId?: string;
  @IsOptional() @IsIn(DELISTING_STATUSES as readonly string[]) status?: string;
}
