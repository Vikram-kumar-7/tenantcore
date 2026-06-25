'use strict';

/**
 * Central application configuration.
 * All environment variables are read ONCE here and exported as a typed config object.
 * Throw early if required variables are missing to prevent silent misconfigurations.
 */

const required = (key) => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
};

const optional = (key, fallback = '') => process.env[key] ?? fallback;

module.exports = {
  env: optional('NODE_ENV', 'development'),
  isDev: optional('NODE_ENV', 'development') === 'development',
  isProd: optional('NODE_ENV', 'development') === 'production',

  app: {
    name: optional('APP_NAME', 'TenantCore'),
    version: optional('APP_VERSION', '1.0.0'),
    port: parseInt(optional('PORT', '3000'), 10),
    baseUrl: optional('API_BASE_URL', 'http://localhost:3000'),
    dashboardUrl: optional('DASHBOARD_URL', 'http://localhost:5173'),
    domainBase: optional('DOMAIN_BASE', 'tenantcore.com'),
  },

  cors: {
    origins: optional('CORS_ORIGINS', 'http://localhost:5173').split(',').map((s) => s.trim()),
  },

  mongodb: {
    masterUri: optional('MONGODB_MASTER_URI', 'mongodb://localhost:27017/tenantcore_master'),
    maxPoolSize: parseInt(optional('MONGODB_MAX_POOL_SIZE', '10'), 10),
    minPoolSize: parseInt(optional('MONGODB_MIN_POOL_SIZE', '2'), 10),
  },

  redis: {
    host: optional('REDIS_HOST', 'localhost'),
    port: parseInt(optional('REDIS_PORT', '6379'), 10),
    password: optional('REDIS_PASSWORD'),
    db: parseInt(optional('REDIS_DB', '0'), 10),
    queueDb: parseInt(optional('REDIS_QUEUE_DB', '1'), 10),
  },

  jwt: {
    accessSecret: optional('JWT_ACCESS_SECRET', 'dev-access-secret-change-in-production'),
    refreshSecret: optional('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-in-production'),
    accessExpiry: optional('JWT_ACCESS_EXPIRY', '15m'),
    refreshExpiry: optional('JWT_REFRESH_EXPIRY', '7d'),
  },

  bcrypt: {
    rounds: parseInt(optional('BCRYPT_ROUNDS', '12'), 10),
  },

  minio: {
    endpoint: optional('MINIO_ENDPOINT', 'localhost'),
    port: parseInt(optional('MINIO_PORT', '9000'), 10),
    useSSL: optional('MINIO_USE_SSL', 'false') === 'true',
    accessKey: optional('MINIO_ACCESS_KEY', 'minioadmin'),
    secretKey: optional('MINIO_SECRET_KEY', 'minioadmin123'),
    bucket: optional('MINIO_BUCKET', 'tenant-files'),
  },

  meilisearch: {
    host: optional('MEILISEARCH_HOST', 'http://localhost:7700'),
    apiKey: optional('MEILISEARCH_ADMIN_API_KEY', 'masterKey'),
  },

  smtp: {
    host: optional('SMTP_HOST', 'localhost'),
    port: parseInt(optional('SMTP_PORT', '587'), 10),
    secure: optional('SMTP_SECURE', 'false') === 'true',
    user: optional('SMTP_USER'),
    pass: optional('SMTP_PASS'),
    from: optional('SMTP_FROM', 'TenantCore <no-reply@tenantcore.com>'),
  },

  loki: {
    host: optional('LOKI_HOST', 'http://localhost:3100'),
  },

  jaeger: {
    endpoint: optional('JAEGER_ENDPOINT', 'http://localhost:14268/api/traces'),
  },

  superAdmin: {
    email: optional('SUPER_ADMIN_EMAIL', 'admin@tenantcore.com'),
    passwordHash: optional('SUPER_ADMIN_PASSWORD_HASH', ''),
  },

  encryption: {
    key: optional('ENCRYPTION_KEY', '0'.repeat(64)),
  },

  webhook: {
    secret: optional('WEBHOOK_SECRET', 'webhook-secret'),
  },

  queue: {
    concurrency: {
      email: parseInt(optional('QUEUE_CONCURRENCY_EMAIL', '10'), 10),
      reports: parseInt(optional('QUEUE_CONCURRENCY_REPORTS', '3'), 10),
      cleanup: parseInt(optional('QUEUE_CONCURRENCY_CLEANUP', '5'), 10),
    },
  },
};
