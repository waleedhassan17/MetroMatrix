import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ErrorCode } from '../../common/errors/codes';
import { isAdminRole } from '../../types';
import { PlatformSettingsService } from './platform-settings.service';
import { SettingsValues } from './settings-schema';

type Service = 'shopping' | 'healthcare' | 'food' | 'kitchen';

/** Customer, partner and rider routes per service. Kitchen is inside Food. */
const KITCHEN = [
  '/food/vendor/kitchen',
  '/food/surplus',
  '/food/me/nutrition',
  '/my-kitchen',
];

const under = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}/`);

export function serviceOf(path: string): Service[] {
  if (under(path, '/shop')) return ['shopping'];
  // `/health` alone is the liveness check, not Healthcare.
  if (path.startsWith('/health/')) return ['healthcare'];
  if (KITCHEN.some((p) => under(path, p))) {
    return path.startsWith('/food') ? ['food', 'kitchen'] : ['kitchen'];
  }
  if (under(path, '/food') || under(path, '/public/food')) return ['food'];
  return [];
}

/** What keeps working in maintenance mode. */
export function maintenanceExempt(
  path: string,
  req: Request & { user?: AuthenticatedUser },
): boolean {
  if (['/auth/me', '/config', '/health'].includes(path)) return true;
  if (under(path, '/admin')) return true;
  // Admins can always sign in, refresh and sign out — to switch it off.
  if (path === '/auth/admin/totp' || under(path, '/auth/web')) return true;
  if (['/auth/logout', '/auth/signout'].includes(path)) return true;
  if (
    path === '/auth/signin' &&
    (req.body as { portal?: unknown } | undefined)?.portal === 'admin'
  ) {
    return true;
  }
  return !!req.user && isAdminRole(req.user.role);
}

/**
 * Global, after JwtAuthGuard (so a signed-in admin is recognised). Enforces
 * maintenance mode (503 MAINTENANCE) and the per-service kill switches
 * (503 SERVICE_PAUSED) from the platform settings.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  private readonly prefix: string;

  constructor(
    private readonly settings: PlatformSettingsService,
    config: ConfigService,
  ) {
    this.prefix = `/${config.get<string>('app.apiPrefix', 'api/v1').replace(/^\/+|\/+$/g, '')}`;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const path = req.path.startsWith(this.prefix)
      ? req.path.slice(this.prefix.length) || '/'
      : req.path;
    const v = await this.settings.values();

    if (v['maintenance.enabled'] === true && !maintenanceExempt(path, req)) {
      throw new ServiceUnavailableException({
        code: ErrorCode.MAINTENANCE,
        message: v['maintenance.message'] as string,
        details: { message: v['maintenance.message'] },
      });
    }
    const paused = serviceOf(path).find((s) => !enabled(v, s));
    if (paused) {
      throw new ServiceUnavailableException({
        code: ErrorCode.SERVICE_PAUSED,
        message: `${LABELS[paused]} is paused for now. Please try again later.`,
        details: { service: paused },
      });
    }
    return true;
  }
}

const LABELS: Record<Service, string> = {
  shopping: 'Shopping',
  healthcare: 'Healthcare',
  food: 'Food',
  kitchen: 'Kitchen',
};

const enabled = (v: SettingsValues, s: Service) =>
  v[`services.${s}.enabled`] !== false;
