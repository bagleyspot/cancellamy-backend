import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../common/pagination';
import { CHANNEL_TYPES } from './registry';

export const BROKER_CATEGORIES = [
  'regulator',
  'opposition_register',
  'phone_directory',
  'caller_id_app',
  'reverse_lookup',
  'business_register',
  'business_info',
  'credit_bureau',
  'kyc_pep',
  'lead_seller',
  'people_search',
  'b2b_enrichment',
  'marketing_adtech',
  'recruitment',
  'risk_mitigation',
  'data_broker',
  'address_data',
  'search_engine',
  'news_archive',
  'public_records',
  'other',
] as const;

export const VERIFICATION_STATUSES = ['verified', 'verified_needs_review', 'third_party', 'needs_research'] as const;

export class BrokersQuery extends PaginationQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(BROKER_CATEGORIES as readonly string[]) category?: string;
  @IsOptional() @IsIn(VERIFICATION_STATUSES as readonly string[]) status?: string;
  @IsOptional() @IsIn(['true', 'false']) sendable?: 'true' | 'false';
}

export class ChannelDto {
  @IsIn(CHANNEL_TYPES as readonly string[]) type!: 'email' | 'pec' | 'web_form' | 'phone' | 'postal' | 'other';
  @IsString() @MaxLength(500) value!: string;
  @IsOptional() @IsString() @MaxLength(100) label?: string;
  @IsBoolean() verified!: boolean;
}

export class AdminBrokerPatchDto {
  @IsOptional() @IsBoolean() sendEnabled?: boolean;
  @IsOptional() @IsIn(VERIFICATION_STATUSES as readonly string[]) verificationStatus?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ChannelDto) channels?: ChannelDto[];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class AutoVerifyBrokersDto {
  @IsOptional() @IsBoolean() crawlWebsites?: boolean;
}
