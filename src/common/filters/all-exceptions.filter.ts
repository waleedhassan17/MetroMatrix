import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { ErrorCode } from '../errors/codes';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred';
const RATE_LIMITED_MESSAGE =
  'Too many requests. Please wait a moment and try again.';

/** 5xx answers that are part of the contract (the AI layer's manual path). */
export const EXPECTED_UNAVAILABLE = new Set<string>([ErrorCode.AI_UNAVAILABLE]);

/**
 * Maps exceptions into the unified error envelope.
 * Supports throwing NestJS HttpExceptions where the response body is either:
 *   - a string: treated as the message
 *   - an object: { code?: string, message?: string, details?: unknown }
 * Any other key on the object is dropped — put extra data under `details`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { user?: AuthenticatedUser }>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL_ERROR;
    let message = GENERIC_ERROR_MESSAGE;
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
        code = this.defaultCodeForStatus(status);
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        message =
          (typeof b.message === 'string' ? b.message : undefined) ??
          (Array.isArray(b.message)
            ? (b.message as string[]).join('; ')
            : undefined) ??
          message;
        code =
          typeof b.code === 'string'
            ? b.code
            : this.defaultCodeForStatus(status);
        if (b.details !== undefined) details = b.details;
        if (Array.isArray(b.message)) details = { fields: b.message };
      } else {
        code = this.defaultCodeForStatus(status);
      }

      // The throttler's own text ("ThrottlerException: Too Many Requests")
      // is not a sentence a person should read.
      if (
        status === HttpStatus.TOO_MANY_REQUESTS &&
        code === ErrorCode.RATE_LIMITED
      ) {
        message = RATE_LIMITED_MESSAGE;
      }
      // A 500 HttpException may still carry internal text; never leak it.
      if (status >= 500 && code === ErrorCode.INTERNAL_ERROR) {
        message = GENERIC_ERROR_MESSAGE;
        details = undefined;
      }
    } else if (exception instanceof Error) {
      // Never leak internal error text (DB errors, stack fragments) to
      // clients — log it, report it, and return a generic message.
      this.logger.error(exception.stack ?? exception.message);
    } else {
      this.logger.error(`Non-Error thrown: ${JSON.stringify(exception)}`);
    }

    const envelope: ErrorEnvelope = {
      success: false,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    };

    // "AI is off or unavailable — here is the manual path" is an expected
    // answer, not a fault: logged as a warning, never sent to Sentry.
    if (EXPECTED_UNAVAILABLE.has(code)) {
      this.logger.warn(`[${req.method}] ${req.path} -> ${status} ${code}`);
    } else if (status >= 500) {
      this.logger.error(
        `[${req.method}] ${req.path} -> ${status} ${code}: ${message}`,
      );
      // Error monitoring — no-op unless SENTRY_DSN is set (see instrument.ts).
      Sentry.withScope((scope) => {
        scope.setTag('route', `${req.method} ${req.route?.path ?? req.path}`);
        scope.setContext('request', {
          method: req.method,
          path: req.path,
          requestId: (req.headers['x-request-id'] as string) ?? null,
        });
        if (req.user?.id) scope.setUser({ id: req.user.id });
        Sentry.captureException(
          exception instanceof Error ? exception : new Error(String(exception)),
        );
      });
    }

    res.status(status).json(envelope);
  }

  private defaultCodeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
      case HttpStatus.UNPROCESSABLE_ENTITY:
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return ErrorCode.VALIDATION_FAILED;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      // A conflict is the caller's answer to act on, not a server fault.
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }
}
