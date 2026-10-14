import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  message?: string;
}

/**
 * Wraps every successful controller response in the standard envelope:
 *   { success: true, data: <payload>, message?: string }
 *
 * If a handler already returns an object shaped like { data, message }
 * it is used as-is; otherwise the raw return value becomes `data`.
 *
 * ⚠ NEVER return an object with a `success` key from a handler: it is passed
 * through untouched, so the client receives no `data` at all. FinMatrix's
 * reset-password and sign-out did exactly that. Return `{ reset: true }`,
 * `{ signedOut: true }` and so on instead.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<SuccessEnvelope<unknown>> {
    return next.handle().pipe(
      map((payload: unknown) => {
        if (
          payload &&
          typeof payload === 'object' &&
          'success' in (payload as Record<string, unknown>)
        ) {
          return payload as SuccessEnvelope<unknown>;
        }

        // A handler that already shaped its own `{ data, message }` is passed
        // through rather than nested one level deeper.
        //
        // ⚠ THIS BRANCH DISCARDS EVERY OTHER KEY. A handler returning
        // `{ data, total, page }` — or any object that happens to carry a
        // `data` field — arrives at the client as a bare `data` value with the
        // siblings silently gone. That is not hypothetical: FinMatrix's P&L
        // drill-down shipped returning its rows under `data` alongside
        // `lineAmount` and `total`, and every client rendered "no
        // transactions" for months because the array replaced the object it
        // was supposed to sit inside.
        //
        // Lists in this API return `{ items, total, page, pageSize }` (see
        // common/pagination/paged.ts). If a response needs metadata beside its
        // rows, name the rows something else — never `data`. And test it over
        // HTTP: a service-level unit test never runs this interceptor, which
        // is precisely why that bug was invisible.
        if (
          payload &&
          typeof payload === 'object' &&
          'data' in (payload as Record<string, unknown>)
        ) {
          const p = payload as { data: unknown; message?: string };
          return {
            success: true,
            data: p.data,
            ...(p.message ? { message: p.message } : {}),
          };
        }

        return { success: true, data: payload ?? null };
      }),
    );
  }
}
