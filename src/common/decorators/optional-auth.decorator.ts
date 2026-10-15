import { applyDecorators, SetMetadata } from '@nestjs/common';
import { PublicRoute } from './public.decorator';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Public route that still recognises a signed-in caller: when a valid bearer
 * token is sent, `req.user` is set (e.g. to mark products already in their
 * wishlist); when it is missing, invalid or expired the request simply runs
 * anonymously — never a 401.
 */
export const OptionalAuth = () =>
  applyDecorators(PublicRoute(), SetMetadata(IS_OPTIONAL_AUTH_KEY, true));
