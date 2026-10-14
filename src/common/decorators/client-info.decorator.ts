import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/** Where a session was opened from — stored on its refresh token. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export const Client = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientInfo => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return {
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    };
  },
);
