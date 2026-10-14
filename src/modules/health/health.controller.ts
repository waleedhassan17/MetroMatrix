import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { PublicRoute } from '../../common/decorators/public.decorator';
import { ErrorCode } from '../../common/errors/codes';
import { appVersion } from '../../common/utils/app-version';

const DB_PING_TIMEOUT_MS = 1500;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Liveness + database reachability in one cheap call, for uptime probes and
   * the Docker HEALTHCHECK. Public and never throttled.
   */
  @Get()
  @PublicRoute()
  @SkipThrottle()
  @ApiOperation({ summary: 'Service and database status.' })
  async check(): Promise<{ status: 'ok'; db: 'up'; version: string }> {
    const version = appVersion();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.dataSource.query('SELECT 1'),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timeout')),
            DB_PING_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
      throw new ServiceUnavailableException({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'The database is unreachable.',
        details: { status: 'error', db: 'down', version },
      });
    } finally {
      clearTimeout(timer);
    }
    return { status: 'ok', db: 'up', version };
  }
}
