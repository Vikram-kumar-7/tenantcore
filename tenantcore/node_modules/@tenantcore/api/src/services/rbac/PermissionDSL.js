'use strict';

const permissionEngine = require('../services/rbac/PermissionEngine');

/**
 * PermissionDSL — human-readable permission checking DSL.
 *
 * Usage:
 *   const { can, cannot } = buildPermissionChecker(user, tenant)
 *
 *   if (can('edit_project')) { ... }
 *   if (cannot('delete_user')) { ... }
 *   if (can('read', 'Report', reportId)) { ... }
 *   const perms = await can.check(['read_users', 'write_users'])
 */

// Mapping from DSL verbs to RBAC permission strings
const VERB_MAP = {
  // User management
  read_users: 'users:read',
  write_users: 'users:write',
  delete_users: 'users:delete',
  edit_user_profile: 'users:write',

  // Roles
  manage_roles: 'roles:manage',

  // Billing
  read_billing: 'billing:read',
  write_billing: 'billing:write',

  // Reports
  export_reports: 'reports:export',

  // Files
  upload_files: 'files:upload',

  // API Keys
  manage_apikeys: 'apikeys:manage',

  // Settings
  read_settings: 'settings:read',
  write_settings: 'settings:write',

  // Audit
  read_audit: 'audit:read',

  // Search
  search: 'search:query',

  // Exports
  create_export: 'export:create',

  // Quota
  read_quota: 'quota:read',

  // Admin panel access (role-based, not permission-based)
  access_admin_panel: 'settings:write',

  // Project-specific (extensible)
  edit_project: 'projects:write',
  delete_project: 'projects:delete',
  read_project: 'projects:read',
};

/**
 * Build a permission checker bound to a specific user and tenant context.
 *
 * @param {Object} user    - User object with resolvedPermissions array
 * @param {Object} tenant  - Tenant context
 * @returns {{ can, cannot }}
 */
function buildPermissionChecker(user, tenant) {
  const permissions = user.resolvedPermissions || [];

  /**
   * Check a single permission using DSL verb or raw permission string.
   * Supports optional chaining: can('export').when(condition)
   */
  function can(verb, resourceType = null, resourceId = null) {
    const permission = VERB_MAP[verb] || verb;
    const allowed = permissionEngine.hasPermission(permissions, permission);

    // Return a chainable object for conditional checks
    const result = {
      valueOf() { return allowed; },
      toString() { return String(allowed); },
      when(condition) { return allowed && condition; },
      [Symbol.toPrimitive]() { return allowed; },
    };

    return result;
  }

  /**
   * Negation of can.
   */
  function cannot(verb) {
    return !can(verb).valueOf();
  }

  /**
   * Batch check multiple permissions. Returns { verb: boolean } map.
   */
  can.check = function (verbs) {
    return verbs.reduce((acc, verb) => {
      const permission = VERB_MAP[verb] || verb;
      acc[verb] = permissionEngine.hasPermission(permissions, permission);
      return acc;
    }, {});
  };

  /**
   * Assert permission — throws PermissionDeniedError if not allowed.
   */
  can.assert = function (verb) {
    if (!can(verb).valueOf()) {
      const { PermissionDeniedError } = require('./core/errors');
      throw new PermissionDeniedError(VERB_MAP[verb] || verb);
    }
  };

  return { can, cannot };
}

module.exports = { buildPermissionChecker, VERB_MAP };
