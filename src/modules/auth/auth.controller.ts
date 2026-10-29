import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { RefreshTokenDto, SigninDto } from './dto/signin.dto';
import {
  ForgotPasswordDto,
  VerifyEmailDto,
  VerifyResetOtpDto,
} from './dto/otp.dto';
import {
  ChangePasswordDto,
  DeleteAccountDto,
  ResetPasswordDto,
} from './dto/password.dto';
import { PasswordResetService } from './password-reset.service';
import { AccountService } from './account.service';
import { GoogleAuthService } from './google-auth.service';
import { GoogleSigninDto } from './dto/google.dto';
import { AdminTotpDto } from './dto/totp.dto';
import { AdminWebSession } from './web/admin-web-session';
import { ApiEnvelopeOk, FlagView } from '../../common/swagger/api-envelope';
import {
  AccountViewDto,
  AuthResultView,
  SigninResultView,
  TokenPairView,
} from './dto/auth.response';
import { PublicRoute } from '../../common/decorators/public.decorator';
import { AllowRestrictedAdmin } from '../../common/decorators/admin-session.decorator';
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
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly account: AccountService,
    private readonly google: GoogleAuthService,
    private readonly web: AdminWebSession,
  ) {}

  @Post('signup')
  @PublicRoute()
  @Throttle({ default: { limit: 20, ttl: HOUR } })
  @ApiOperation({
    summary:
      'Register a customer or partner. Returns AuthResult and emails a verification code.',
  })
  @ApiEnvelopeOk(AuthResultView, { status: 201 })
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
  @ApiEnvelopeOk(SigninResultView)
  signin(@Body() dto: SigninDto, @Client() client: ClientInfo) {
    return this.auth.signin(dto, client);
  }

  @Post('admin/totp')
  @PublicRoute()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: MINUTE } })
  @ApiOperation({
    summary:
      'Admin sign-in step 2: { challengeToken, code } or { challengeToken, recoveryCode } → AuthResult.',
  })
  @ApiHeader({
    name: 'X-Client',
    required: false,
    description:
      'admin-web: the web console. The refresh token is then set as the HttpOnly mm_admin_rt cookie and left out of the body (needs X-Requested-With and the console Origin).',
  })
  @ApiEnvelopeOk(AuthResultView)
  async adminTotp(
    @Body() dto: AdminTotpDto,
    @Client() client: ClientInfo,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.web.wantsCookie(req)) return this.auth.adminTotp(dto, client);
    this.web.assertFromConsole(req);
    const result = await this.auth.adminTotp(dto, client, 'admin_web');
    return this.web.handOver(res, result);
  }

  @Post('google')
  @PublicRoute()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ApiOperation({
    summary:
      'Continue with Google (customer portal only). Links by Google id or verified email, or creates a verified customer.',
  })
  googleSignin(@Body() dto: GoogleSigninDto, @Client() client: ClientInfo) {
    return this.google.signIn(dto.idToken, client);
  }

  @Post('refresh-token')
  @PublicRoute()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: MINUTE } })
  @ApiOperation({
    summary:
      'Rotate a refresh token: a new { accessToken, refreshToken, expiresIn } in the same session.',
  })
  @ApiEnvelopeOk(TokenPairView)
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
  @ApiEnvelopeOk(FlagView)
  signout(@Headers('authorization') authorization?: string) {
    return this.auth.signoutByToken(authorization);
  }

  // ── Email verification (bearer: signup already returned a session) ───────

  @Post('verify-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 15 * MINUTE } })
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Confirm the email address with the 6-digit code. Returns { user, business }.',
  })
  verifyEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyEmailDto,
  ) {
    return this.auth.verifyEmail(user.id, dto.otp);
  }

  @Post('resend-verification')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: HOUR } })
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Email a fresh verification code. 60 s cooldown (429 RESEND_COOLDOWN).',
  })
  resendVerification(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.resendVerification(user.id);
  }

  // ── Forgot password (OTP flow) ────────────────────────────────────────────

  @Post('forgot-password')
  @PublicRoute()
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 15 * MINUTE } })
  @ApiOperation({
    summary:
      'Email a password-reset code. Always 200 { delivered: true } — no account enumeration.',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordReset.forgot(dto.email);
  }

  @Post('verify-otp')
  @PublicRoute()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 15 * MINUTE } })
  @ApiOperation({
    summary: 'Exchange the reset code for a single-use { resetToken }.',
  })
  verifyOtp(@Body() dto: VerifyResetOtpDto) {
    return this.passwordReset.verifyOtp(dto.email, dto.otp);
  }

  @Post('reset-password')
  @PublicRoute()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 15 * MINUTE } })
  @ApiOperation({
    summary:
      'Set a new password with the reset token. Signs the account out everywhere.',
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwordReset.reset(dto.resetToken, dto.password);
  }

  // ── The signed-in account ─────────────────────────────────────────────────

  @Post('change-password')
  @AllowRestrictedAdmin()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 15 * MINUTE } })
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Change the password (Google-only accounts may set a first one without currentPassword). Signs out other devices.',
  })
  @ApiEnvelopeOk(FlagView)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.account.changePassword(
      user.id,
      user.sid,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Delete('account')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 15 * MINUTE } })
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Delete the account (password, or a fresh Google idToken). Anonymises it and revokes every session.',
  })
  deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteAccountDto,
  ) {
    return this.account.deleteAccount(user.id, dto);
  }

  @Get('me')
  @AllowRestrictedAdmin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in account: { user, business }.' })
  @ApiEnvelopeOk(AccountViewDto)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }
}
