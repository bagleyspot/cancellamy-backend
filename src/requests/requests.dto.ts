import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsMongoId, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { PaginationQuery } from '../common/pagination';
import { BROKER_CATEGORIES } from '../brokers/brokers.dto';
import { ALL_STATUSES, GROUP_STATUSES } from './status';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListRequestsQuery extends PaginationQuery {
  @IsOptional() @IsIn(['erasure', 'access']) kind?: 'erasure' | 'access';
  @IsOptional() @IsMongoId() profileId?: string;
  @IsOptional() @IsIn(Object.keys(GROUP_STATUSES)) group?: 'in_progress' | 'action_required' | 'completed' | 'not_removable';
  @IsOptional() @IsIn(ALL_STATUSES) status?: string;
  @IsOptional() @IsIn(BROKER_CATEGORIES as readonly string[]) category?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class OutcomeDto {
  @IsIn(['completed', 'refused', 'action_required', 'in_progress']) outcome!: 'completed' | 'refused' | 'action_required' | 'in_progress';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CustomRequestDto {
  @IsMongoId() profileId!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsOptional() @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }) @MaxLength(300) website?: string;
  @IsOptional() @IsEmail() @MaxLength(254) contactEmail?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class SimulateReplyDto {
  @IsIn(['completed', 'refused', 'id_required', 'unknown']) kind!: 'completed' | 'refused' | 'id_required' | 'unknown';
}

export class ProvideIdDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class SummaryQuery {
  @IsOptional() @IsMongoId() profileId?: string;
}

export const DATA_CATEGORIES = ['identifiers', 'contacts', 'addresses', 'professional', 'financial', 'online_activity', 'location', 'demographics', 'other'] as const;

export class CreateAccessRequestsDto {
  @IsMongoId() profileId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(200, { each: true }) brokerIds!: string[];
}

export class SendRequestsDto {
  /** The drafts the user chose to send now (SEND_SELECTION=manual). At most 10 per call. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsMongoId({ each: true }) requestIds!: string[];
}

export class AccessFindingsDto {
  @IsBoolean() found!: boolean;
  @IsArray() @ArrayMaxSize(9) @IsIn(DATA_CATEGORIES as readonly string[], { each: true }) categories!: string[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
