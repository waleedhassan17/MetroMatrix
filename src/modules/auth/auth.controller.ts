import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly account: AccountService,
  ) {}

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
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 15 * MINUTE } })
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Change the password (Google-only accounts may set a first one without currentPassword). Signs out other devices.',
  })
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in account: { user, business }.' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }
}
