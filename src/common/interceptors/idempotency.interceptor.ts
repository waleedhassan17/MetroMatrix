import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, concatMap } from 'rxjs/operators';
import { IdempotencyRecord } from './idempotency-record.entity';
import { ErrorCode } from '../errors/codes';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import {
  REQUIRE_IDEMPOTENCY_KEY,
  SKIP_IDEMPOTENCY_KEY,
} from '../decorators/require-idempotency-key.decorator';

const MAX_KEY_LENGTH = 200;

/**
 * Idempotency for mutating POSTs.
 *
 * When an authenticated POST carries an `Idempotency-Key` header, the first
 * request runs normally and its (enveloped) response is stored keyed by
 * (caller, key). A retry with the same key returns the stored response instead
 * of executing the handler again — so a double-tap / network retry can never
 * double-post.
 *
 * Unauthenticated routes are skipped on purpose: their responses are sign-in
 * and sign-up results carrying live tokens, which must never be stored at rest
 * or handed to whoever repeats the key.
 *
 * Routes marked @RequireIdempotencyKey() (checkout) refuse to run without
 * the header, and a key may only ever be replayed on the path it was first
 * used for.
 *
 * Registered BEFORE the response-envelope interceptor so it is the OUTER
 * interceptor: it captures (and replays) the fully-enveloped client response.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly repo: Repository<IdempotencyRecord>,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const res = context.switchToHttp().getResponse<Response>();
    const header =
      req.headers['idempotency-key'] ?? req.headers['x-idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;

    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_IDEMPOTENCY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required && !key) {
      throw new BadRequestException({
        code: ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        message:
          'Send an Idempotency-Key header (a fresh UUID per attempt) so a retry can never place the order twice.',
      });
    }
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_IDEMPOTENCY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip || req.method !== 'POST' || !key || !req.user?.id) {
      return next.handle();
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters`,
      });
    }

    const scope = `user:${req.user.id}`;
    const path = (req.originalUrl || req.url || '').split('?')[0];
    const inProgress = () =>
      new ConflictException({
        code: ErrorCode.IDEMPOTENCY_IN_PROGRESS,
        message:
          'A request with this Idempotency-Key is already being processed',
      });

    const existing = await this.repo.findOne({
      where: { scope, idempotencyKey: key },
    });
    if (existing && existing.path !== path.slice(0, 300)) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message:
          'This Idempotency-Key was already used for a different request.',
      });
    }
    if (existing) {
      if (existing.status === 'completed') {
        if (existing.statusCode) res.status(existing.statusCode);
        return of(existing.responseBody);
      }
      throw inProgress();
    }

    // Reserve the key. The unique (scope, key) index makes this the race
    // arbiter: if a concurrent request already reserved it, our insert throws.
    try {
      await this.repo.insert({
        scope,
        idempotencyKey: key,
        method: req.method,
        path: path.slice(0, 300),
        status: 'pending',
      });
    } catch {
      const now = await this.repo.findOne({
        where: { scope, idempotencyKey: key },
      });
      if (now?.status === 'completed') {
        if (now.statusCode) res.status(now.statusCode);
        return of(now.responseBody);
      }
      throw inProgress();
    }

    return next.handle().pipe(
      // Wait for the record to be written before the response goes out, so a
      // retry that arrives right behind it replays instead of conflicting.
      concatMap(async (body) => {
        // TypeORM cannot type an `unknown` jsonb column in an update.
        const patch = {
          status: 'completed',
          statusCode: res.statusCode ?? 200,
          responseBody: body ?? null,
        } as QueryDeepPartialEntity<IdempotencyRecord>;
        await this.repo.update({ scope, idempotencyKey: key }, patch);
        return body;
      }),
      catchError((err) =>
        // The handler failed — release the reservation so the client can retry.
        from(
          this.repo
            .delete({ scope, idempotencyKey: key })
            .catch(() => undefined),
        ).pipe(concatMap(() => throwError(() => err))),
      ),
    );
  }
}
