import {
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { PublicRoute } from '../../../common/decorators/public.decorator';
import {
  Client,
  ClientInfo,
} from '../../../common/decorators/client-info.decorator';
import { ApiEnvelopeOk, FlagView } from '../../../common/swagger/api-envelope';
import { ErrorCode } from '../../../common/errors/codes';
import { TokenService } from '../token.service';
import { AuthService } from '../auth.service';
import { AdminWebSession, ADMIN_WEB_CSRF_VALUE } from './admin-web-session';

export class WebAccessTokenView {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ description: 'Seconds until the access token expires.' })
  expiresIn!: number;
}

const CsrfHeader = () =>
  ApiHeader({
    name: 'X-Requested-With',
    required: true,
    schema: { enum: [ADMIN_WEB_CSRF_VALUE] },
  });

/**
 * The web console's half of the session: the refresh token travels only as
 * the HttpOnly `mm_admin_rt` cookie, scoped to this path. Same rotation and
 * reuse detection as /auth/refresh-token, which in turn refuses these tokens.
 */
@ApiTags('auth: admin web')
@Controller('auth/web')
export class AdminWebController {
  constructor(
    private readonly session: AdminWebSession,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  @Post('refresh')
  @PublicRoute()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @CsrfHeader()
  @ApiOperation({
    summary:
      'Rotate the console session from its cookie → { accessToken, expiresIn } and a new cookie. 401 SESSION_IDLE after the idle limit.',
  })
  @ApiEnvelopeOk(WebAccessTokenView)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Client() client: ClientInfo,
  ): Promise<WebAccessTokenView> {
    this.session.assertFromConsole(req);
    const token = this.session.read(req);
    try {
      if (!token) {
        throw new UnauthorizedException({
          code: ErrorCode.REFRESH_INVALID,
          message: 'Your session has ended. Please sign in again.',
        });
      }
      const pair = await this.tokens.rotate(token, client, {
        client: 'admin_web',
        idleMs: this.session.idleMs,
      });
      this.session.set(res, pair.refreshToken);
      return { accessToken: pair.accessToken, expiresIn: pair.expiresIn };
    } catch (err) {
      this.session.clear(res);
      throw err;
    }
  }

  @Post('logout')
  @PublicRoute()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @CsrfHeader()
  @ApiOperation({
    summary:
      'Sign the console out: revoke its session and access token, clear the cookie. Idempotent.',
  })
  @ApiEnvelopeOk(FlagView)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ signedOut: true }> {
    this.session.assertFromConsole(req);
    const token = this.session.read(req);
    if (token) await this.tokens.revokeByRefreshToken(token, 'admin_web');
    await this.auth.signoutByToken(req.headers.authorization);
    this.session.clear(res);
    return { signedOut: true };
  }
}
