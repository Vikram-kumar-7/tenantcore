'use strict';

const permissionEngine = require('../services/rbac/PermissionEngine');
const { PermissionDeniedError, AuthenticationError } = require('../core/errors');

/**
 * RBAC Middleware Factory
 * Returns Express middleware that enforces permission and role checks.
 */

/**
 * requirePermission('users:write') — Check a single permission.
 * Resolves permissions from cache or DB on first hit.
 */
const requirePermission = (permission) => async (req, res, next) => {
  try {
    const { user, db } = req.context;
    if (!user) throw new AuthenticationError();

    // Resolve permissions if not already attached (e.g. from JWT payload)
    const permissions = user.resolvedPermissions?.length
      ? user.resolvedPermissions
      : await permissionEngine.resolvePermissions(user, db);

    if (!permissionEngine.hasPermission(permissions, permission)) {
      throw new PermissionDeniedError(permission);
    }

    // Attach resolved permissions for downstream use
    req.context.user.resolvedPermissions = permissions;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * requireAnyPermission(['users:read', 'users:write']) — Check if user has at least one.
 */
const requireAnyPermission = (permissions) => async (req, res, next) => {
  try {
    const { user, db } = req.context;
    if (!user) throw new AuthenticationError();

    const resolved = user.resolvedPermissions?.length
      ? user.resolvedPermissions
      : await permissionEngine.resolvePermissions(user, db);

    const hasAny = permissions.some((p) => permissionEngine.hasPermission(resolved, p));
    if (!hasAny) {
      throw new PermissionDeniedError(`One of: ${permissions.join(', ')}`);
    }

    req.context.user.resolvedPermissions = resolved;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * requireAllPermissions(['users:read', 'users:write']) — Check all permissions.
 */
const requireAllPermissions = (permissions) => async (req, res, next) => {
  try {
    const { user, db } = req.context;
    if (!user) throw new AuthenticationError();

    const resolved = user.resolvedPermissions?.length
      ? user.resolvedPermissions
      : await permissionEngine.resolvePermissions(user, db);

    for (const p of permissions) {
      if (!permissionEngine.hasPermission(resolved, p)) {
        throw new PermissionDeniedError(p);
      }
    }

    req.context.user.resolvedPermissions = resolved;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * requireRole('admin') — Minimum role level check.
 * Hierarchy: owner > admin > member > viewer
 */
const ROLE_LEVELS = { owner: 100, admin: 75, member: 50, viewer: 25 };

const requireRole = (minRole) => (req, res, next) => {
  try {
    const { user } = req.context;
    if (!user) throw new AuthenticationError();

    const userLevel = ROLE_LEVELS[user.role] ?? 0;
    const requiredLevel = ROLE_LEVELS[minRole] ?? 0;

    if (userLevel < requiredLevel) {
      throw new PermissionDeniedError(`Role '${minRole}' or higher required`);
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * requirePolicy(policyName, resourceLoader) — Apply a policy check.
 * resourceLoader is a function that extracts the resource from req.
 */
const requirePolicy = (policyName, resourceLoader) => async (req, res, next) => {
  try {
    const { user } = req.context;
    const policyEngine = require('../services/rbac/PolicyEngine');

    const resource = typeof resourceLoader === 'function'
      ? await resourceLoader(req)
      : resourceLoader;

    await policyEngine.evaluate(policyName, user, resource, req.context);
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * requireSuperAdmin — Only platform super-admins can access.
 * Super-admin status is determined by the SUPER_ADMIN_EMAIL env variable.
 */
const requireSuperAdmin = (req, res, next) => {
  try {
    const config = require('../config/app.config');
    const { user } = req.context;
    if (!user || user.email !== config.superAdmin.email) {
      throw new PermissionDeniedError('Super admin access required');
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireRole,
  requirePolicy,
  requireSuperAdmin,
};
