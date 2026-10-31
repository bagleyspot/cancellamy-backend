import { HttpException, HttpStatus } from '@nestjs/common';

export type ApiErrorCode =
  | 'EMAIL_NOT_VERIFIED'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_TOKEN'
  | 'PROFILE_LIMIT_REACHED'
  | 'AUTHORIZATION_REQUIRED'
  | 'PROFILE_NOT_READY'
  | 'INVALID_STATE'
  | 'RATE_LIMITED'
  | 'CUSTOM_LIMIT_REACHED'
  | 'SIMULATION_DISABLED'
  | 'VALIDATION_ERROR'
  | 'SMTP_CONNECTION_FAILED'
  | 'SMTP_HOST_NOT_ALLOWED'
  | 'GMAIL_AUTH_FAILED'
  | 'GMAIL_ADDRESS_NOT_IN_PROFILE'
  | 'IDENTITY_REQUIRED'
  | 'VERIFICATION_CODE_INVALID'
  | 'VERIFICATION_RATE_LIMITED'
  | 'FEATURE_DISABLED'
  | 'TIMESTAMP_UNAVAILABLE';

/** HTTP exception carrying a stable machine-readable code (see docs/api-types.ts). */
export class CodedException extends HttpException {
  constructor(status: HttpStatus, message: string, code: ApiErrorCode) {
    super({ message, code }, status);
  }
}

export const badRequest = (message: string, code: ApiErrorCode) => new CodedException(HttpStatus.BAD_REQUEST, message, code);
export const forbidden = (message: string, code: ApiErrorCode) => new CodedException(HttpStatus.FORBIDDEN, message, code);
export const conflict = (message: string, code: ApiErrorCode) => new CodedException(HttpStatus.CONFLICT, message, code);
export const unauthorized = (message: string, code: ApiErrorCode) => new CodedException(HttpStatus.UNAUTHORIZED, message, code);
export const tooManyRequests = (message: string, code: ApiErrorCode) => new CodedException(HttpStatus.TOO_MANY_REQUESTS, message, code);
