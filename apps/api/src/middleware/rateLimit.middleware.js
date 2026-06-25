'use strict';

const { getRedisClient } = require('../services/redis');
const { RateLimitError } = require('../core/errors');
const { getPlan, SPECIAL_RATE_LIMITS } = require('../config/plans.config');
const logger = require('../services/logger');

/**
 * Rate Limiting Middleware — Redis Sliding Window Algorithm
 *
 * More accurate than fixed windows: the window slides with each request.
 * A request at 1:00:30 uses the window [00:30–1:00:30], not [1:00:00–1:00:59].
 *
 * Redis key: ratelimit:tenant:{tenantId}:{windowStart}
 * Each window is {windowSize} seconds. INCR + TTL = atomic sliding counter.
 */

/**
 * Build the rate limiter for tenant API requests.
 * Limits are determined by the tenant's subscription plan.
 */
const tenantRateLimit = async (req, res, next) => {
  try {
    const { tenant } = req.context || {};
    if (!tenant) return next();

    const plan = getPlan(tenant.plan);
    const { requestsPerMinute, window: windowSecs } = plan.rateLimit;

    const redis = getRedisClient();

    // If Redis is not ready, allow request through (graceful degradation)
    if (redis.status !== 'ready') {
      res.set({ 'X-RateLimit-Limit': requestsPerMinute, 'X-RateLimit-Remaining': '?', 'X-RateLimit-Degraded': 'true' });
      return next();
    }

    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % windowSecs);
    const key = `ratelimit:tenant:${tenant.id}:${windowStart}`;

    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSecs * 2);
    }

    const remaining = Math.max(0, requestsPerMinute - count);
    const resetAt = windowStart + windowSecs;

    res.set({
      'X-RateLimit-Limit': requestsPerMinute,
      'X-RateLimit-Remaining': remaining,
      'X-RateLimit-Reset': resetAt,
      'X-RateLimit-Window': windowSecs,
    });

    if (count > requestsPerMinute) {
      const retryAfter = resetAt - now;
      res.set('Retry-After', retryAfter);
      throw new RateLimitError(retryAfter);
    }

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Factory: create a specific rate limiter for sensitive endpoints.
 * Used for login, signup, password reset.
 *
 * @param {string} prefix  - Redis key prefix (e.g. 'login', 'signup')
 * @param {number} max     - Max requests allowed
 * @param {number} windowSecs - Window in seconds
 * @param {Function} keyExtractor - (req) => string key to rate-limit on
 */
const createEndpointLimiter = (prefix, max, windowSecs, keyExtractor) => {
  return async (req, res, next) => {
    try {
      const identifier = keyExtractor(req);
      const redis = getRedisClient();
      const key = `ratelimit:${prefix}:${identifier}`;

      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSecs);
      }

      if (count > max) {
        const ttl = await redis.ttl(key);
        throw new RateLimitError(ttl);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

// ─── Pre-built special rate limiters ──────────────────────────────────────────

/** 5 login attempts per 15 minutes per IP */
const loginRateLimit = createEndpointLimiter(
  'login',
  SPECIAL_RATE_LIMITS.login.requests,
  SPECIAL_RATE_LIMITS.login.window,
  (req) => req.ip
);

/** 3 signups per hour per IP */
const signupRateLimit = createEndpointLimiter(
  'signup',
  SPECIAL_RATE_LIMITS.signup.requests,
  SPECIAL_RATE_LIMITS.signup.window,
  (req) => req.ip
);

/** 3 password reset requests per hour per email */
const passwordResetRateLimit = createEndpointLimiter(
  'password-reset',
  SPECIAL_RATE_LIMITS.passwordReset.requests,
  SPECIAL_RATE_LIMITS.passwordReset.window,
  (req) => req.body?.email || req.ip
);

module.exports = {
  tenantRateLimit,
  loginRateLimit,
  signupRateLimit,
  passwordResetRateLimit,
  createEndpointLimiter,
};
