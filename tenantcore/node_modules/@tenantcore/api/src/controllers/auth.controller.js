'use strict';

const { body, validationResult } = require('express-validator');
const jwtService = require('../services/auth/JwtService');
const tokenStore = require('../services/auth/TokenStore');
const passwordService = require('../services/auth/PasswordService');
const permissionEngine = require('../services/rbac/PermissionEngine');
const { getMasterConnection } = require('../db/master');
const tenantSchema = require('../models/master/Tenant.model');
const { getTenantConnection } = require('../db/tenant');
const userSchema = require('../models/tenant/User.model');
const {
  InvalidCredentialsError,
  AuthenticationError,
  AccountLockedError,
  DuplicateEmailError,
  ValidationError,
  TenantNotFoundError,
} = require('../core/errors');
const logger = require('../services/logger');
const EventBus = require('../core/EventBus');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMasterModels() {
  const conn = getMasterConnection();
  const Tenant = (() => { try { return conn.model('Tenant'); } catch { return conn.model('Tenant', tenantSchema); } })();
  return { Tenant };
}

async function getTenantModels(tenant) {
  const conn = await getTenantConnection(tenant);
  const User = (() => { try { return conn.model('User'); } catch { return conn.model('User', userSchema); } })();
  return { User };
}

async function issueTokenPair(user, tenant, db) {
  // Resolve permissions for embedding in access token
  const permissions = await permissionEngine.resolvePermissions(user, db);
  user._resolvedPermissions = permissions;

  const accessToken = jwtService.issueAccessToken(user, tenant);
  const { token: refreshToken, jti } = jwtService.issueRefreshToken(user._id, tenant._id);
  await tokenStore.storeRefreshToken(jti, user._id, tenant._id);

  return { accessToken, refreshToken };
}

// ─── Validation chains ────────────────────────────────────────────────────────

const signupValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('firstName').notEmpty().trim().withMessage('First name is required'),
  body('lastName').notEmpty().trim().withMessage('Last name is required'),
  body('tenantName').notEmpty().trim().withMessage('Company/workspace name is required'),
  body('tenantSlug')
    .optional()
    .matches(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
    .withMessage('Slug must be lowercase alphanumeric with hyphens'),
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password is required'),
];

// ─── Controller functions ─────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/signup
 * Create a new tenant + owner user account.
 */
const signup = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const { email, password, firstName, lastName, tenantName, tenantSlug } = req.body;

    // Validate password strength
    const violations = passwordService.validate(password);
    if (violations.length) throw new ValidationError('Weak password', violations);

    // Enqueue tenant provisioning — actual creation happens asynchronously
    const TenantProvisioner = require('../services/tenant/TenantProvisioner');
    const { tenant, user, accessToken, refreshToken } = await TenantProvisioner.provision({
      email,
      password,
      firstName,
      lastName,
      tenantName,
      tenantSlug,
    });

    logger.info('New tenant signed up', { tenantSlug: tenant.slug, email });

    res.status(201).json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        tenant: {
          id: tenant._id,
          slug: tenant.slug,
          name: tenant.name,
          plan: tenant.plan,
          status: tenant.status,
        },
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/login
 */
const login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new ValidationError('Validation failed', errors.array());

    const { email, password, tenantSlug } = req.body;

    const { Tenant } = getMasterModels();

    // Resolve tenant (from body slug or from middleware)
    const tenant = req.tenant ||
      (tenantSlug ? await Tenant.findBySlug(tenantSlug) : null);

    if (!tenant) throw new TenantNotFoundError(tenantSlug);

    const { User } = await getTenantModels(tenant);
    const user = await User.findByEmail(tenant._id, email).select('+passwordHash');

    if (!user) throw new InvalidCredentialsError();
    if (user.isLocked) throw new AccountLockedError(user.lockedUntil);
    if (!['active', 'invited'].includes(user.status)) throw new InvalidCredentialsError();

    // Verify password
    const isValid = await passwordService.compare(password, user.passwordHash);
    if (!isValid) {
      await user.incrementFailedLogin();
      throw new InvalidCredentialsError();
    }

    await user.resetFailedLogin();

    const conn = await getTenantConnection(tenant);
    const { accessToken, refreshToken } = await issueTokenPair(user, tenant, conn);

    // Emit event for audit + analytics (async, non-blocking)
    EventBus.emit('user.login', { tenantId: tenant._id, userId: user._id, ip: req.ip });

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user._id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          avatar: user.avatar,
        },
        tenant: { id: tenant._id, slug: tenant.slug, name: tenant.name, plan: tenant.plan },
      },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/refresh
 */
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AuthenticationError('Refresh token required');

    const payload = jwtService.verifyRefreshToken(refreshToken);
    const stored = await tokenStore.getRefreshToken(payload.jti);
    if (!stored) throw new AuthenticationError('Refresh token is invalid or expired. Please log in again.');

    const { Tenant } = getMasterModels();
    const tenant = await Tenant.findById(stored.tenantId).lean();
    if (!tenant) throw new TenantNotFoundError();

    const { User } = await getTenantModels(tenant);
    const user = await User.findById(stored.userId);
    if (!user || !user.isActive) throw new AuthenticationError('User not found or inactive');

    // Rotate refresh token
    const { token: newRefreshToken } = await tokenStore.rotateRefreshToken(
      payload.jti, user._id, tenant._id
    );

    const conn = await getTenantConnection(tenant);
    const permissions = await permissionEngine.resolvePermissions(user, conn);
    user._resolvedPermissions = permissions;

    const newAccessToken = jwtService.issueAccessToken(user, tenant);

    EventBus.emit('auth.token_refresh', { tenantId: tenant._id, userId: user._id });

    res.json({
      success: true,
      data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/auth/logout
 */
const logout = async (req, res, next) => {
  try {
    const authHeader = req.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      await tokenStore.blacklistAccessToken(token);

      const payload = jwtService.decodeUnsafe(token);
      if (payload?.jti) {
        await tokenStore.deleteRefreshToken(payload.jti).catch(() => {});
      }
    }

    EventBus.emit('user.logout', {
      tenantId: req.context?.tenant?.id,
      userId: req.context?.user?.id,
    });

    res.json({
      success: true,
      data: { message: 'Logged out successfully' },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/auth/me
 */
const me = async (req, res, next) => {
  try {
    const { user, db, tenant } = req.context;
    const User = db.User;

    const fullUser = await User.findById(user.id).lean();
    if (!fullUser) throw new AuthenticationError('User not found');

    res.json({
      success: true,
      data: {
        user: {
          id: fullUser._id,
          email: fullUser.email,
          firstName: fullUser.firstName,
          lastName: fullUser.lastName,
          fullName: fullUser.firstName + ' ' + fullUser.lastName,
          role: fullUser.role,
          avatar: fullUser.avatar,
          lastLoginAt: fullUser.lastLoginAt,
          permissions: user.resolvedPermissions,
          notificationPreferences: fullUser.notificationPreferences,
        },
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          plan: tenant.plan,
          branding: tenant.branding,
        },
      },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  signup,
  login,
  refresh,
  logout,
  me,
  signupValidation,
  loginValidation,
};
