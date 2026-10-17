import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ErrorCode } from '../../common/errors/codes';
import {
  ACCESS_AUDIENCE,
  AccessTokenPayload,
  TokenService,
} from './token.service';

const revoked = () =>
  new UnauthorizedException({
    code: ErrorCode.TOKEN_REVOKED,
    message: 'This session has been signed out. Please sign in again.',
  });

const invalid = () =>
  new UnauthorizedException({
    code: ErrorCode.UNAUTHORIZED,
    message: 'Invalid or expired token.',
  });

/**
 * What makes an access token good, in one place: the HTTP JwtStrategy and
 * the realtime gateway's handshake both use it. The user row is re-read
 * every time — role, status and token_version come from the database, and
 * signed-out tokens (the jti denylist) are refused until they expire.
 */
@Injectable()
export class AccessTokenValidator {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  /** A raw bearer token: signature, audience 'access', expiry — then check(). */
  async verify(token: string): Promise<AuthenticatedUser> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        audience: ACCESS_AUDIENCE,
        algorithms: ['HS256'],
      });
    } catch {
      throw invalid();
    }
    return this.check(payload);
  }

  /** A payload whose signature is already verified. */
  async check(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (payload.jti && (await this.tokens.isRevoked(payload.jti))) {
      throw revoked();
    }
    const user = await this.users.findById(payload.sub);
    if (!user || user.status === 'deleted') throw invalid();
    // Password reset / disable / delete bump the version: every older access
    // token dies at once.
    if (payload.ver !== user.tokenVersion) throw revoked();
    if (user.status === 'disabled') {
      throw new ForbiddenException({
        code: ErrorCode.ACCOUNT_DISABLED,
        message: 'This account has been disabled.',
      });
    }
    return {
      id: user.id,
      email: user.email,
      // From the row, not the token: a role change applies on the next request.
      role: user.role,
      sid: payload.sid,
      emailVerified: user.isEmailVerified,
    };
  }
}
