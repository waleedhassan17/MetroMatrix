import { NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../../common/errors/codes';

/** Another vendor's row, or none: always 404. */
export const kitchenNotFound = (what: string) =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: `${what} not found.`,
  });
