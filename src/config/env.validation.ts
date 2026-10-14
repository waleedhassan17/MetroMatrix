import * as Joi from 'joi';

/** Required in production, optional (and allowed empty) everywhere else. */
const requiredInProd = (schema: Joi.StringSchema) =>
  schema.when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  });

const base64Key32 = Joi.string()
  .custom((value: string, helpers) =>
    Buffer.from(value, 'base64').length === 32
      ? value
      : helpers.error('any.invalid'),
  )
  .messages({
    'any.invalid':
      '"TOTP_ENC_KEY" must be 32 random bytes, base64-encoded ' +
      "(node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\")",
  });

/**
 * Boot fails fast — with every problem listed (abortEarly: false in
 * AppModule) — when a required key is missing or malformed.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  APP_URL: Joi.string().uri().required(),
  CORS_ORIGINS: Joi.string().required(),

  // Either a single DATABASE_URL (Heroku/Neon/...) OR the discrete DB_* fields.
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .optional(),
  DB_HOST: Joi.string().when('DATABASE_URL', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  DB_PORT: Joi.number().default(5433),
  DB_USERNAME: Joi.string().when('DATABASE_URL', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  DB_PASSWORD: Joi.string().min(12).when('DATABASE_URL', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  DB_NAME: Joi.string().when('DATABASE_URL', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  DB_SSL: Joi.boolean().default(false),
  DB_SSL_REJECT_UNAUTHORIZED: Joi.boolean().default(true),
  DB_POOL_MAX: Joi.number().default(10),
  DB_POOL_MIN: Joi.number().default(2),
  DB_LOGGING: Joi.boolean().default(false),
  DB_MIGRATIONS_RUN: Joi.boolean().default(false),
  // Migrations own the schema. Never synchronize a database that matters.
  DB_SYNCHRONIZE: Joi.boolean()
    .default(false)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.valid(false),
    }),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('30d'),
  REFRESH_REUSE_GRACE_SECONDS: Joi.number().min(0).max(10).default(10),
  OTP_PEPPER: Joi.string().min(32).required(),
  TOTP_ENC_KEY: base64Key32.required(),
  BCRYPT_ROUNDS: Joi.number()
    .max(14)
    .default(12)
    .when('NODE_ENV', {
      is: 'test',
      then: Joi.number().min(4),
      otherwise: Joi.number().min(10),
    }),

  // Brevo SMTP. Empty outside production → emails are logged to the console.
  MAIL_HOST: requiredInProd(Joi.string()),
  MAIL_PORT: Joi.number().default(587),
  MAIL_USER: requiredInProd(Joi.string()),
  MAIL_PASS: requiredInProd(Joi.string()),
  MAIL_FROM: requiredInProd(Joi.string()),

  GOOGLE_CLIENT_IDS: requiredInProd(Joi.string()),
  CLOUDINARY_CLOUD_NAME: requiredInProd(Joi.string()),
  CLOUDINARY_API_KEY: requiredInProd(Joi.string()),
  CLOUDINARY_API_SECRET: requiredInProd(Joi.string()),

  SENTRY_DSN: Joi.string().uri().optional().allow(''),
  SWAGGER_ENABLED: Joi.boolean().default(true),
  LOG_LEVEL: Joi.string()
    .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent')
    .default('info'),
  THROTTLE_TTL_SECONDS: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(100),

  // Read only by `npm run seed:superadmin`, which validates them itself.
  SUPER_ADMIN_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .optional()
    .allow(''),
  SUPER_ADMIN_PASSWORD: Joi.string().optional().allow(''),
}).unknown(true);
