import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { ErrorCode } from '../../../common/errors/codes';
import {
  ACCESS_AUDIENCE,
  AccessTokenPayload,
  TokenService,
} from '../token.service';

const revoked = () =>
  new UnauthorizedException({
    code: ErrorCode.TOKEN_REVOKED,
    message: 'This session has been signed out. Please sign in again.',
  });

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('jwt.secret'),
      algorithms: ['HS256'],
      // Only access tokens. A TOTP challenge (aud 'totp') is refused here.
      audience: ACCESS_AUDIENCE,
      ignoreExpiration: false,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    // Signed-out access tokens are rejected until they expire.
    if (payload.jti && (await this.tokens.isRevoked(payload.jti))) {
      throw revoked();
    }
    const user = await this.users.findById(payload.sub);
    if (!user || user.status === 'deleted') {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid or expired token.',
      });
    }
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
