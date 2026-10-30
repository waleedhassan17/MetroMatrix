import * as Joi from 'joi';

/** Required in production, optional (and allowed empty) everywhere else. */
const requiredInProd = (schema: Joi.StringSchema) =>
  schema.when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  });

/** Required when VIDEO_PROVIDER=jaas, optional otherwise. */
const requiredForJaas = (schema: Joi.StringSchema) =>
  schema.when('VIDEO_PROVIDER', {
    is: 'jaas',
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
  // Verification links point here, so production must be https.
  APP_URL: Joi.string()
    .required()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().uri({ scheme: ['https'] }),
      otherwise: Joi.string().uri(),
    }),
  // Comma-separated. A `*` entry lets any site call the API from a browser,
  // so production must name its origins.
  CORS_ORIGINS: Joi.string()
    .required()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().custom((value: string, helpers) =>
        value.split(',').some((o) => o.trim() === '*')
          ? helpers.error('any.invalid')
          : value,
      ),
    })
    .messages({
      'any.invalid':
        '"CORS_ORIGINS" must list the allowed origins in production, not "*"',
    }),
  // The app's deep-link scheme (MetroMatrix_App app.json `scheme`).
  APP_SCHEME: Joi.string()
    .pattern(/^[a-z][a-z0-9+.-]*$/)
    .empty('')
    .default('metromatrix'),
  EMAIL_VERIFY_TTL_HOURS: Joi.number()
    .integer()
    .min(1)
    .max(168)
    .empty('')
    .default(24),

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
  DB_SSL: Joi.boolean().empty('').default(false),
  DB_SSL_REJECT_UNAUTHORIZED: Joi.boolean().empty('').default(true),
  DB_POOL_MAX: Joi.number().default(10),
  DB_POOL_MIN: Joi.number().default(2),
  DB_LOGGING: Joi.boolean().empty('').default(false),
  DB_MIGRATIONS_RUN: Joi.boolean().empty('').default(false),
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
  // Optional: the address the business-suspended email tells partners to write to.
  SUPPORT_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .optional()
    .allow(''),

  GOOGLE_CLIENT_IDS: requiredInProd(Joi.string()),
  CLOUDINARY_CLOUD_NAME: requiredInProd(Joi.string()),
  CLOUDINARY_API_KEY: requiredInProd(Joi.string()),
  CLOUDINARY_API_SECRET: requiredInProd(Joi.string()),

  // Expo push. Off unless explicitly enabled.
  PUSH_ENABLED: Joi.boolean().empty('').default(false),
  EXPO_ACCESS_TOKEN: Joi.string().optional().allow(''),

  // Healthcare video (docs/VIDEO.md): public_jitsi = meet.jit.si (dev/demo),
  // jaas = 8x8 Jitsi as a Service with signed room tokens.
  VIDEO_PROVIDER: Joi.string()
    .valid('public_jitsi', 'jaas')
    .empty('')
    .default('public_jitsi'),
  JAAS_APP_ID: requiredForJaas(Joi.string().pattern(/^vpaas-magic-cookie-/)),
  JAAS_KID: requiredForJaas(
    Joi.string().pattern(/^vpaas-magic-cookie-[^/]+\/.+/),
  ),
  /** PEM; "\n" escapes are accepted for one-line config vars. */
  JAAS_PRIVATE_KEY: requiredForJaas(Joi.string()),

  // Symptom checker model. Optional: without a key the keyword matcher answers.
  GEMINI_API_KEY: Joi.string().optional().allow(''),
  GEMINI_MODEL: Joi.string().empty('').default('gemini-2.5-flash'),

  // seed:shopping only: the four demo partners' password (never in code).
  SEED_DEMO_PASSWORD: Joi.string().optional().allow(''),

  // Scheduled jobs (shopping deadlines, reminders, completion).
  JOBS_ENABLED: Joi.boolean().empty('').default(true),

  SENTRY_DSN: Joi.string().uri().optional().allow(''),
  SWAGGER_ENABLED: Joi.boolean().empty('').default(true),
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
