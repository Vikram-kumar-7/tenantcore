'use strict';

const jwtService = require('../services/auth/JwtService');
const tokenStore = require('../services/auth/TokenStore');
const { getMasterConnection } = require('../db/master');
const apiKeySchema = require('../models/master/ApiKey.model');
const { AuthenticationError, InvalidTokenError } = require('../core/errors');
const crypto = require('crypto');
const logger = require('../services/logger');

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
 * Auth Middleware
 *
 * Authenticates every protected request via:
 * 1. Bearer JWT token in Authorization header
 * 2. API Key in Authorization header (tc_live_... format)
 * 3. API Key in X-API-Key header
 */

/**
 * authenticateJwt — Verify Bearer token and attach user to req.user
 */
const authenticateJwt = async (req, res, next) => {
  try {
    const authHeader = req.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Bearer token required');
    }

    const token = authHeader.slice(7);
    const payload = jwtService.verifyAccessToken(token);

    // Check token blacklist (logout invalidation)
    const isBlacklisted = await tokenStore.isBlacklisted(payload.jti);
    if (isBlacklisted) {
      throw new InvalidTokenError('Token has been revoked');
    }

    // Validate tenant matches if tenant is set on request
    if (req.tenant && req.tenant._id.toString() !== payload.tenantId) {
      throw new InvalidTokenError('Token tenant mismatch');
    }

    // Attach pre-resolved permissions from JWT payload (avoids extra DB call)
    req.user = {
      _id: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      email: payload.email,
      _resolvedPermissions: payload.permissions || [],
      _authMethod: 'jwt',
      _jti: payload.jti,
    };

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * authenticateApiKey — Verify API key from Authorization or X-API-Key header
 */
const authenticateApiKey = async (req, res, next) => {
  try {
    const rawKey = req.get('X-API-Key') || (() => {
      const auth = req.get('Authorization') || '';
      return auth.startsWith('tc_') ? auth : null;
    })();

    if (!rawKey) {
      throw new AuthenticationError('API key required');
    }

    // Hash the raw key for DB lookup (we never store raw keys)
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const ApiKey = getApiKeyModel();
    const apiKey = await ApiKey.findOne({ keyHash, status: 'active' }).select('+keyHash');

    if (!apiKey) {
      throw new InvalidTokenError('Invalid or revoked API key');
    }

    // Check expiry
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new InvalidTokenError('API key has expired');
    }

    // Validate tenant match
    if (req.tenant && apiKey.tenantId.toString() !== req.tenant._id.toString()) {
      throw new InvalidTokenError('API key does not belong to this tenant');
    }

    // Record usage asynchronously (don't block request)
    apiKey.recordUsage().catch((err) =>
      logger.warn('Failed to record API key usage', { error: err.message })
    );

    req.user = {
      _id: null,          // API key auth has no user
      tenantId: apiKey.tenantId.toString(),
      role: 'api-key',
      email: null,
      _resolvedPermissions: apiKey.scopes,
      _authMethod: 'apikey',
      _apiKeyId: apiKey._id,
    };

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * authenticate — Auto-detect auth method (JWT or API Key) and validate.
 * Use this for routes that accept both.
 */
const authenticate = async (req, res, next) => {
  const authHeader = req.get('Authorization') || '';
  const apiKeyHeader = req.get('X-API-Key') || '';

  if (apiKeyHeader || authHeader.startsWith('tc_')) {
    return authenticateApiKey(req, res, next);
  }
  if (authHeader.startsWith('Bearer ')) {
    return authenticateJwt(req, res, next);
  }

  next(new AuthenticationError('No authentication credentials provided'));
};

/**
 * optionalAuth — Attach user if credentials are present, but don't reject if absent.
 * Used for endpoints that work for both authenticated and anonymous users.
 */
const optionalAuth = async (req, res, next) => {
  const authHeader = req.get('Authorization') || '';
  if (!authHeader) {
    req.user = null;
    return next();
  }

  // Run normal auth but swallow errors
  authenticate(req, res, (err) => {
    if (err) req.user = null;
    next();
  });
};

module.exports = { authenticate, authenticateJwt, authenticateApiKey, optionalAuth };
