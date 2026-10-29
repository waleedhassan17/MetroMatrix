import { AsyncLocalStorage } from 'async_hooks';
import { Request } from 'express';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

export type AuditRequest = Request & {
  user?: AuthenticatedUser;
};

export interface RequestContext {
  /**
   * The live request object, not a snapshot of its fields.
   *
   * Middleware runs BEFORE guards in Nest's pipeline, so at the moment we open
   * this scope `req.user` does not exist yet — JwtAuthGuard sets it a step
   * later. Holding the request itself means anything reading the context
   * during the handler (the audit service) sees the populated values.
   */
  req: AuditRequest;
  /** Audit rows this request has written (AdminAuditInterceptor reads it). */
  audits: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `req` as the ambient request context. */
export function runWithRequestContext<T>(req: AuditRequest, fn: () => T): T {
  return storage.run({ req, audits: 0 }, fn);
}

/**
 * The acting user and client details for the in-flight request.
 *
 * Returns nulls outside a request — scheduled jobs and seed scripts have no
 * HTTP context. Callers record a system actor rather than failing.
 */
export function currentActor(): {
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
} {
  const req = storage.getStore()?.req;
  if (!req) {
    return { userId: null, ipAddress: null, userAgent: null, requestId: null };
  }
  return {
    userId: req.user?.id ?? null,
    ipAddress: req.ip ?? null,
    userAgent: (req.headers?.['user-agent'] as string | undefined) ?? null,
    requestId: (req.headers?.['x-request-id'] as string | undefined) ?? null,
  };
}

/** Count an audit row against the in-flight request (no-op outside one). */
export function countAudit(): void {
  const store = storage.getStore();
  if (store) store.audits += 1;
}

/** How many audit rows the in-flight request has written so far. */
export function auditsThisRequest(): number {
  return storage.getStore()?.audits ?? 0;
}
