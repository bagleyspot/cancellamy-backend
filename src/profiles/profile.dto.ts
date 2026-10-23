import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isoDate', async: false })
class IsoDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value) && d.getTime() < Date.now() && d.getUTCFullYear() > 1900;
  }
  defaultMessage(): string {
    return 'dateOfBirth must be a valid past date in YYYY-MM-DD format';
  }
}

export class AddressInputDto {
  @IsString() @IsNotEmpty() @MaxLength(160) street!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) city!: string;
  @IsString() @IsNotEmpty() @MaxLength(12) zip!: string;
  @IsOptional() @IsString() @MaxLength(40) province?: string;
  @IsString() @Length(2, 2) country!: string;
}

export class ProfileInputDto {
  @IsString() @IsNotEmpty() @MaxLength(80) firstName!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) lastName!: string;
  @IsOptional() @Validate(IsoDateConstraint) dateOfBirth?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsEmail({}, { each: true }) @MaxLength(254, { each: true }) emails!: string[];
  @IsArray() @ArrayMaxSize(5) @Matches(/^[+\d][\d\s().-]{5,24}$/, { each: true, message: 'each phone must look like a phone number' }) phones!: string[];
  @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => AddressInputDto) addresses!: AddressInputDto[];
  @IsOptional() @Matches(/^[A-Za-z0-9]{11,16}$/, { message: 'fiscalCode must be 11-16 alphanumeric characters' }) fiscalCode?: string;
  @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(80, { each: true }) aliases!: string[];
}

export class UpdateProfileDto extends PartialType(ProfileInputDto) {}

export class SignAuthorizationDto {
  @IsString() @IsNotEmpty() @MaxLength(200) signatureName!: string;
  @Equals(true, { message: 'accepted must be true' }) accepted!: true;
}
