import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/codes';

/** 503 AI_UNAVAILABLE — with the manual way to do the same thing. */
export const aiUnavailable = (manual: string, reason = 'unavailable') =>
  new HttpException(
    {
      code: ErrorCode.AI_UNAVAILABLE,
      message: 'This smart feature is unavailable right now.',
      details: { reason, manual },
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );

/** 429 AI_QUOTA_REACHED — this month's allowance is used; it resets on the 1st. */
export const aiQuotaReached = (
  key: string,
  limit: number,
  resetsOn: string,
  manual?: string,
) =>
  new HttpException(
    {
      code: ErrorCode.AI_QUOTA_REACHED,
      message: `This month's ${key === 'voice_minutes_month' ? 'voice minutes are' : 'smart actions are'} used up. They reset on ${resetsOn}.`,
      details: { key, limit, resetsOn, ...(manual ? { manual } : {}) },
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
