'use strict';

const crypto = require('crypto');
const { getMasterConnection } = require('../db/master');
const apiKeySchema = require('../models/master/ApiKey.model');
const { InvalidTokenError, AuthenticationError } = require('../core/errors');
const logger = require('../services/logger');
const cache = require('../services/cache/CacheService');

let ApiKeyModel = null;
const getApiKeyModel = () => {
  if (!ApiKeyModel) {
    const conn = getMasterConnection();
    try { ApiKeyModel = conn.model('ApiKey'); }
    catch { ApiKeyModel = conn.model('ApiKey', apiKeySchema); }
  }
  return ApiKeyModel;
};

/**
 * API Key Middleware
 *
 * Dedicated middleware for routes that ONLY accept API key authentication.
 * For mixed auth (JWT or API key), use auth.middleware.js `authenticate`.
 *
 * Key format:    tc_live_{64 hex chars}  (68 chars total)
 * Verification:  SHA-256(rawKey) → lookup in DB
 * Cache:         API key hash → key metadata, TTL 5 min
 */
const apiKeyMiddleware = async (req, res, next) => {
  try {
    // Accept API key from multiple locations
    const rawKey =
      req.get('X-API-Key') ||
      req.get('Authorization')?.replace(/^(Bearer|ApiKey)\s+/i, '') ||
      req.query.api_key;

    if (!rawKey) {
      throw new AuthenticationError('API key required (X-API-Key header or api_key query parameter)');
    }

    if (!rawKey.startsWith('tc_live_') && !rawKey.startsWith('tc_test_')) {
      throw new InvalidTokenError('Invalid API key format');
    }

    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const cacheKey = `apikey:${keyHash}`;

    // Cache-aside for API key lookup (avoid DB hit on every request)
    let keyData = await cache.get(cacheKey);

    if (!keyData) {
      const ApiKey = getApiKeyModel();
      const apiKey = await ApiKey.findOne({ keyHash, status: 'active' })
        .select('-keyHash')
        .lean();

      if (!apiKey) {
        throw new InvalidTokenError('Invalid or revoked API key');
      }

      keyData = {
        id: apiKey._id,
        tenantId: apiKey.tenantId,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt,
        name: apiKey.name,
      };

      // Cache for 5 minutes (revocation may take up to 5 min to propagate)
      await cache.set(cacheKey, keyData, 300);
    }

    // Check expiry
    if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
      await cache.del(cacheKey); // Remove stale cache
      throw new InvalidTokenError('API key has expired');
    }

    // Attach to request (same shape as JWT auth for downstream compatibility)
    req.user = {
      _id: null,
      tenantId: keyData.tenantId.toString(),
      role: 'api-key',
      email: null,
      _resolvedPermissions: keyData.scopes,
      _authMethod: 'apikey',
      _apiKeyId: keyData.id,
      _apiKeyName: keyData.name,
    };

    // Record usage in background (async, non-blocking)
    setImmediate(async () => {
      try {
        const ApiKey = getApiKeyModel();
        await ApiKey.updateOne(
          { _id: keyData.id },
          { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } }
        );
      } catch (err) {
        logger.warn('Failed to update API key usage', { error: err.message });
      }
    });

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { apiKeyMiddleware };
