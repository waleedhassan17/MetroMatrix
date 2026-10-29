import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { concatMap, Observable } from 'rxjs';
import { ROLES_KEY, UserRole } from '../decorators/roles.decorator';
import { auditsThisRequest } from '../context/request-context';
import { OperationalAuditService } from './operational-audit.service';

/**
 * The safety net under "every admin write is audited". Services write their
 * own row, with the changed fields before and after; if a successful admin
 * write (any non-GET route behind @Roles with an admin role) wrote none, this
 * writes a generic one and logs a warning — so a route added later can never
 * go unaudited, and the gap shows up in the logs to be fixed properly.
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminAuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: OperationalAuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const adminWrite =
      req.method !== 'GET' &&
      !!roles?.some((r) => r === 'admin' || r === 'super_admin');
    if (!adminWrite) return next.handle();

    return next.handle().pipe(
      concatMap(async (body: unknown) => {
        if (auditsThisRequest() === 0) {
          const action = `admin.${context.getClass().name}.${context.getHandler().name}`;
          this.logger.warn(`Admin write without its own audit row: ${action}`);
          await this.audit.record({
            action: action.slice(0, 64),
            targetType: 'route',
            targetId: (req.params?.id as string | undefined) ?? null,
            details: {
              method: req.method,
              route: (req.route as { path?: string } | undefined)?.path ?? null,
              params: req.params ?? {},
            },
          });
        }
        return body;
      }),
    );
  }
}
