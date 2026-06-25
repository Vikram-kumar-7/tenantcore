'use strict';

const crypto = require('crypto');
const { getRedisClient } = require('../redis');
const jwtService = require('./JwtService');
const config = require('../../config/app.config');
const CacheService = require('../cache/CacheService');
const logger = require('../logger');

/**
 * TokenStore — manages refresh tokens and the access token blacklist in Redis.
 *
 * Refresh token storage:
 *   Key:   refresh:{jti}
 *   Value: { userId, tenantId, createdAt }   (stored as JSON)
 *   TTL:   7 days (matches refresh token expiry)
 *
 * Access token blacklist:
 *   Key:   blacklist:token:{jti}
 *   Value: "1"
 *   TTL:   Remaining lifetime of the access token (so it auto-expires)
 */
class TokenStore {
  constructor() {
    this.redis = getRedisClient();
  }

  // ─── Refresh Tokens ─────────────────────────────────────────────────────────

  /**
   * Store a refresh token in Redis.
   * We hash the JTI before using it as a key to prevent timing attacks.
   */
  async storeRefreshToken(jti, userId, tenantId) {
    try {
      const key = CacheService.keys.refreshToken(this._hashJti(jti));
      const value = JSON.stringify({ userId, tenantId, createdAt: new Date().toISOString() });
      const ttl = 7 * 24 * 60 * 60;
      if (this.redis.status !== 'ready') return; // Graceful degradation
      await this.redis.set(key, value, 'EX', ttl);
    } catch (err) {
      logger.warn('TokenStore.storeRefreshToken failed', { error: err.message });
    }
  }

  /**
   * Retrieve and validate a refresh token from Redis.
   * Returns null if not found (already rotated or expired).
   */
  async getRefreshToken(jti) {
    try {
      if (this.redis.status !== 'ready') return null;
      const key = CacheService.keys.refreshToken(this._hashJti(jti));
      const data = await this.redis.get(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (err) {
      logger.warn('TokenStore.getRefreshToken failed', { error: err.message });
      return null;
    }
  }

  /**
   * Delete a refresh token (called on logout or rotation).
   */
  async deleteRefreshToken(jti) {
    const key = CacheService.keys.refreshToken(this._hashJti(jti));
    await this.redis.del(key);
  }

  /**
   * Rotate a refresh token: delete old one, return new token details.
   * Called during the token refresh flow.
   */
  async rotateRefreshToken(oldJti, userId, tenantId) {
    // Atomically: delete old, issue new
    await this.deleteRefreshToken(oldJti);
    const { token, jti: newJti } = jwtService.issueRefreshToken(userId, tenantId);
    await this.storeRefreshToken(newJti, userId, tenantId);
    return { token, jti: newJti };
  }

  // ─── Access Token Blacklist ─────────────────────────────────────────────────

  /**
   * Blacklist an access token so it cannot be used after logout.
   * TTL is set to the token's remaining lifetime so Redis auto-cleans it.
   */
  async blacklistAccessToken(token) {
    try {
      const decoded = jwtService.decodeUnsafe(token);
      if (!decoded?.jti) return;

      const ttl = jwtService.remainingTTL(decoded);
      if (ttl <= 0) return; // Already expired, no need to blacklist

      const key = CacheService.keys.tokenBlacklist(decoded.jti);
      await this.redis.set(key, '1', 'EX', ttl);

      logger.debug('Access token blacklisted', { jti: decoded.jti, ttl });
    } catch (err) {
      logger.warn('Failed to blacklist token', { error: err.message });
    }
  }

  /**
   * Check if an access token's JTI is blacklisted.
   */
  async isBlacklisted(jti) {
    try {
      if (this.redis.status !== 'ready') return false; // Allow when Redis down
      const key = CacheService.keys.tokenBlacklist(jti);
      const result = await this.redis.exists(key);
      return result === 1;
    } catch {
      return false;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  _hashJti(jti) {
    return crypto.createHash('sha256').update(jti).digest('hex');
  }
}

module.exports = new TokenStore();
