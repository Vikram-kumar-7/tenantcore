'use strict';

const logger = require('../logger');

/**
 * CacheService — Redis-backed cache with graceful degradation.
 * If Redis is unavailable, all operations are no-ops (cache miss pattern).
 * This ensures the application remains functional without Redis.
 */
class CacheService {
  constructor() {
    this._redis = null;
    this.defaultTTL = 300;
  }

  get redis() {
    if (!this._redis) {
      try {
        const { getRedisClient } = require('../redis');
        this._redis = getRedisClient();
      } catch {
        return null;
      }
    }
    return this._redis;
  }

  _isConnected() {
    return this.redis?.status === 'ready';
  }

  async get(key) {
    if (!this._isConnected()) return null;
    try {
      const data = await this.redis.get(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (err) {
      logger.warn('Cache get failed', { key, error: err.message });
      return null;
    }
  }

  async set(key, value, ttlSeconds = this.defaultTTL) {
    if (!this._isConnected()) return;
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.redis.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await this.redis.set(key, serialized);
      }
    } catch (err) {
      logger.warn('Cache set failed', { key, error: err.message });
    }
  }

  async del(key) {
    if (!this._isConnected()) return;
    try {
      await this.redis.del(key);
    } catch (err) {
      logger.warn('Cache del failed', { key, error: err.message });
    }
  }

  async invalidatePattern(pattern) {
    if (!this._isConnected()) return;
    try {
      let cursor = '0';
      let deletedCount = 0;
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
          deletedCount += keys.length;
        }
      } while (cursor !== '0');

      if (deletedCount > 0) {
        logger.debug('Cache invalidated', { pattern, count: deletedCount });
      }
    } catch (err) {
      logger.warn('Cache invalidatePattern failed', { pattern, error: err.message });
    }
  }

  async wrap(key, ttlSeconds, loader) {
    const cached = await this.get(key);
    if (cached !== null) return cached;
    const value = await loader();
    if (value !== null && value !== undefined) {
      await this.set(key, value, ttlSeconds);
    }
    return value;
  }

  async incr(key, ttlSeconds = null) {
    if (!this._isConnected()) return 1; // Always allow when Redis is down
    const val = await this.redis.incr(key);
    if (val === 1 && ttlSeconds) {
      await this.redis.expire(key, ttlSeconds);
    }
    return val;
  }

  async setnx(key, value, ttlSeconds) {
    if (!this._isConnected()) return true; // Optimistic grant when Redis is down
    const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  static keys = {
    tenantConfig: (tenantId) => `cache:tenant:${tenantId}:config`,
    tenantPlan: (tenantId) => `cache:tenant:${tenantId}:plan`,
    tenantRoles: (tenantId) => `cache:tenant:${tenantId}:roles`,
    tenantAnalytics: (tenantId) => `cache:tenant:${tenantId}:analytics`,
    tenantAll: (tenantId) => `cache:tenant:${tenantId}:*`,
    userPermissions: (userId) => `cache:user:${userId}:permissions`,
    userSession: (userId) => `cache:session:${userId}`,
    tokenBlacklist: (jti) => `blacklist:token:${jti}`,
    refreshToken: (tokenId) => `refresh:${tokenId}`,
    rateLimitTenant: (tenantId, windowStart) => `ratelimit:tenant:${tenantId}:${windowStart}`,
    provisionStatus: (tenantId) => `provision:${tenantId}:status`,
    cronLock: (jobName) => `cron:lock:${jobName}`,
    workerHeartbeat: (workerId) => `worker:heartbeat:${workerId}`,
    quotaCounter: (tenantId, metric, month) => `quota:${tenantId}:${metric}:${month}`,
  };
}

// Export class and singleton
const cacheService = new CacheService();

// Alias static keys on the singleton for convenience
cacheService.keys = CacheService.keys;

module.exports = cacheService;
module.exports.CacheService = CacheService;
