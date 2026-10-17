import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { ACCESS_AUDIENCE, AccessTokenPayload } from '../token.service';
import { AccessTokenValidator } from '../access-token-validator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly validator: AccessTokenValidator,
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

  validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    return this.validator.check(payload);
  }
}
