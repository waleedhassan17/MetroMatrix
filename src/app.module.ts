import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { SentryModule } from '@sentry/nestjs/setup';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import mailConfig from './config/mail.config';
import authConfig from './config/auth.config';
import integrationsConfig from './config/integrations.config';
import notificationsConfig from './config/notifications.config';
import jobsConfig from './config/jobs.config';
import { envValidationSchema } from './config/env.validation';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { IdempotencyRecord } from './common/interceptors/idempotency-record.entity';
import { RolesGuard } from './common/guards/roles.guard';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { OperationalAuditModule } from './common/audit/operational-audit.module';
import { buildLoggerParams } from './common/logging/pino-options';

import { MailModule } from './modules/mail/mail.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { MediaModule } from './modules/media/media.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { AdminModule } from './modules/admin/admin.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ShoppingModule } from './modules/shopping/shopping.module';
import { HealthcareModule } from './modules/healthcare/healthcare.module';
import { FoodModule } from './modules/food/food.module';
import { PlansModule } from './modules/plans/plans.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    // Sentry first so its error hooks wrap everything that follows.
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        mailConfig,
        authConfig,
        integrationsConfig,
        notificationsConfig,
        jobsConfig,
      ],
      envFilePath: ['.env'],
      // Tests set their own environment (test/setup-env.ts); a developer's
      // .env must not leak into them.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      cache: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions =>
        config.getOrThrow<TypeOrmModuleOptions>('database'),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('app.throttleTtlSeconds', 60) * 1000,
          limit: config.get<number>('app.throttleLimit', 100),
        },
      ],
    }),
    ScheduleModule.forRoot(),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildLoggerParams({
          level: config.get<string>('app.logLevel', 'info'),
          pretty: config.get<string>('app.nodeEnv') === 'development',
        }),
    }),
    MailModule,
    OperationalAuditModule,
    TypeOrmModule.forFeature([IdempotencyRecord]),
    UsersModule,
    AuthModule,
    MediaModule,
    BusinessesModule,
    AdminModule,
    AddressesModule,
    NotificationsModule,
    ShoppingModule,
    HealthcareModule,
    PlansModule,
    FoodModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Idempotency is registered first → it is the OUTER interceptor, so it
    // captures and replays the fully-enveloped response.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // After JwtAuthGuard so req.user is set; no-op on routes without @Roles.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // RequestContextMiddleware first: it opens the AsyncLocalStorage scope
    // that carries the acting user down to the audit service. Guards populate
    // req.user a step later, which is why the context holds the request
    // object rather than a snapshot of its fields.
    consumer
      .apply(RequestContextMiddleware, RequestIdMiddleware)
      .forRoutes('*');
  }
}
