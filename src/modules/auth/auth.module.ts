import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessTokenValidator } from './access-token-validator';
import { TokenService } from './token.service';
import { AccountViewService } from './account-view.service';
import { AuthMaintenanceService } from './auth-maintenance.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { RevokedAccessToken } from './entities/revoked-access-token.entity';
import { EmailVerificationOtp } from './entities/email-verification-otp.entity';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetOtp } from './entities/password-reset-otp.entity';
import { PasswordResetService } from './password-reset.service';
import { PasswordHasher } from './password-hasher';
import { AccountService } from './account.service';
import { GoogleTokenVerifier } from './google-token-verifier';
import { GoogleAuthService } from './google-auth.service';
import { TotpService } from './totp.service';
import { AdminRecoveryCode } from './entities/admin-recovery-code.entity';
import { AdminTotpEnrolGuard } from './guards/admin-totp-enrol.guard';
import { IdempotencyRecord } from '../../common/interceptors/idempotency-record.entity';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './strategies/jwt.strategy';

import { AdminWebController } from './web/admin-web.controller';
import { AdminWebSession } from './web/admin-web-session';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    TypeOrmModule.forFeature([
      RefreshToken,
      RevokedAccessToken,
      EmailVerificationOtp,
      PasswordResetOtp,
      AdminRecoveryCode,
      IdempotencyRecord,
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwt.secret'),
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController, AdminWebController],
  providers: [
    AuthService,
    TokenService,
    AccountViewService,
    EmailVerificationService,
    PasswordResetService,
    PasswordHasher,
    AccountService,
    GoogleTokenVerifier,
    GoogleAuthService,
    TotpService,
    AdminTotpEnrolGuard,
    AuthMaintenanceService,
    JwtStrategy,
    AccessTokenValidator,
    AdminWebSession,
  ],
  exports: [
    AuthService,
    GoogleAuthService,
    TokenService,
    AccountViewService,
    AccountService,
    PasswordHasher,
    TotpService,
    AdminTotpEnrolGuard,
    AccessTokenValidator,
    AdminWebSession,
    UsersModule,
  ],
})
export class AuthModule {}
