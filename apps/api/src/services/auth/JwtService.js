'use strict';

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../../config/app.config');
const { InvalidTokenError, AuthenticationError } = require('../../core/errors');

/**
 * JwtService — issues and verifies access + refresh tokens.
 *
 * Access Token:  15 minutes, contains full user context
 * Refresh Token: 7 days, minimal payload (sub + jti for Redis lookup)
 */
class JwtService {
  /**
   * Issue a new access token with user and tenant context.
   * The token payload matches the spec exactly so middleware can trust it.
   */
  issueAccessToken(user, tenant) {
    const payload = {
      sub: user._id.toString(),
      tenantId: tenant._id.toString(),
      role: user.role,
      permissions: user._resolvedPermissions || [], // Pre-resolved by auth service
      type: 'access',
      jti: uuidv4(),
    };

    return jwt.sign(payload, config.jwt.accessSecret, {
      expiresIn: config.jwt.accessExpiry,
      issuer: 'tenantcore',
      audience: tenant.slug,
    });
  }

  /**
   * Issue a new refresh token.
   * Minimal payload — the real data is fetched from Redis on refresh.
   */
  issueRefreshToken(userId, tenantId) {
    const jti = uuidv4();
    const token = jwt.sign(
      {
        sub: userId.toString(),
        tenantId: tenantId.toString(),
        type: 'refresh',
        jti,
      },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiry, issuer: 'tenantcore' }
    );

    return { token, jti };
  }

  /**
   * Verify and decode an access token.
   * Throws InvalidTokenError on any failure so callers don't need to handle jwt errors.
   */
  verifyAccessToken(token) {
    try {
      return jwt.verify(token, config.jwt.accessSecret, { issuer: 'tenantcore' });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new InvalidTokenError('Access token has expired');
      }
      throw new InvalidTokenError('Invalid access token');
    }
  }

  /**
   * Verify and decode a refresh token.
   */
  verifyRefreshToken(token) {
    try {
      const payload = jwt.verify(token, config.jwt.refreshSecret, { issuer: 'tenantcore' });
      if (payload.type !== 'refresh') {
        throw new InvalidTokenError('Not a refresh token');
      }
      return payload;
    } catch (err) {
      if (err instanceof InvalidTokenError) throw err;
      if (err.name === 'TokenExpiredError') {
        throw new InvalidTokenError('Refresh token has expired. Please log in again.');
      }
      throw new InvalidTokenError('Invalid refresh token');
    }
  }

  /**
   * Decode a token WITHOUT verifying signature (used to read expiry for blacklisting).
   */
  decodeUnsafe(token) {
    return jwt.decode(token);
  }

  /**
   * Calculate remaining TTL of a token in seconds.
   */
  remainingTTL(decoded) {
    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, decoded.exp - now);
  }

  /**
   * Extract the Bearer token from the Authorization header.
   */
  extractFromHeader(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Authorization header missing or malformed');
    }
    return authHeader.slice(7);
  }
}

module.exports = new JwtService();
