import { Injectable } from '@nestjs/common';

/** Injectable clock so time-dependent logic (deadlines, renewals) can be tested deterministically. */
@Injectable()
export class Clock {
  private offsetMs = 0;

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  /** Test helper: move the clock forward. */
  advance(ms: number): void {
    this.offsetMs += ms;
  }
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
