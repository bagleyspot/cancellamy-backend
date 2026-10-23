import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class SendCodeDto {
  @IsIn(['email', 'phone']) type!: 'email' | 'phone';
  @IsString() @IsNotEmpty() @MaxLength(254) value!: string;
}

export class ConfirmCodeDto extends SendCodeDto {
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' }) code!: string;
}
