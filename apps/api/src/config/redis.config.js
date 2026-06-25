'use strict';

const config = require('./app.config');

/**
 * Redis client configuration.
 * Exports base ioredis options used across all Redis clients.
 */
const redisConfig = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  db: config.redis.db,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    // Exponential backoff: 50ms, 100ms, 200ms, ... capped at 2s
    return Math.min(times * 50, 2000);
  },
  enableReadyCheck: true,
  lazyConnect: false,
};

/**
 * Queue-specific Redis config (separate DB to avoid key conflicts)
 */
const queueRedisConfig = {
  ...redisConfig,
  db: config.redis.queueDb,
};

module.exports = { redisConfig, queueRedisConfig };
