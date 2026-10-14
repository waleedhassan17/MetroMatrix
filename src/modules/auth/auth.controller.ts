import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { RefreshTokenDto, SigninDto } from './dto/signin.dto';
import { PublicRoute } from '../../common/decorators/public.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import {
  Client,
  ClientInfo,
} from '../../common/decorators/client-info.decorator';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @PublicRoute()
  @Throttle({ default: { limit: 20, ttl: HOUR } })
  @ApiOperation({
    summary:
      'Register a customer or partner. Returns AuthResult and emails a verification code.',
  })
  signup(@Body() dto: SignupDto, @Client() client: ClientInfo) {
    return this.auth.signup(dto, client);
  }

  @Post('signin')
  @PublicRoute()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiOperation({
    summary:
      'Email + password on a portal. AuthResult, or { totpRequired, challengeToken } on the admin portal.',
  })
  signin(@Body() dto: SigninDto, @Client() client: ClientInfo) {
    return this.auth.signin(dto, client);
  }

  @Post('refresh-token')
  @PublicRoute()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: MINUTE } })
  @ApiOperation({
    summary:
      'Rotate a refresh token: a new { accessToken, refreshToken, expiresIn } in the same session.',
  })
  refresh(@Body() dto: RefreshTokenDto, @Client() client: ClientInfo) {
    return this.auth.refresh(dto.refreshToken, client);
  }

  // Public + self-authenticating (the service verifies the bearer token) so
  // sign-out is idempotent: an already-invalid/expired token still gets 200
  // and leaks nothing. '/signout' is kept as an alias.
  @Post(['logout', 'signout'])
  @PublicRoute()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: MINUTE } })
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Sign this device out: revoke its session and the access token. Idempotent.',
  })
  signout(@Headers('authorization') authorization?: string) {
    return this.auth.signoutByToken(authorization);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in account: { user, business }.' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }
}
