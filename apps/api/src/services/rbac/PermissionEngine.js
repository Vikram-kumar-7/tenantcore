'use strict';

const cache = require('../cache/CacheService');
const logger = require('../logger');

/**
 * PermissionEngine — core RBAC logic.
 * Resolves a user's full permission set (role permissions + overrides)
 * and caches the result in Redis for 5 minutes.
 *
 * Permission format: "resource:action" (e.g., "users:write")
 * Wildcard: "*" grants all permissions (Owner only)
 */
class PermissionEngine {
  /**
   * Resolve the complete permission set for a user.
   * Uses cache-aside: Redis cache → DB lookup → cache result.
   */
  async resolvePermissions(user, db) {
    const cacheKey = cache.keys.userPermissions(user._id.toString());

    return cache.wrap(cacheKey, 300, async () => {
      return this._fetchPermissionsFromDB(user, db);
    });
  }

  /**
   * Load permissions from the database.
   * Combines role permissions with individual overrides.
   */
  async _fetchPermissionsFromDB(user, db) {
    try {
      const Role = db.model('Role');
      let rolePermissions = [];

      // System roles resolve from built-in definitions
      if (['owner', 'admin', 'member', 'viewer'].includes(user.role)) {
        const { SYSTEM_ROLE_PERMISSIONS } = require('../../models/tenant/Role.model');
        rolePermissions = SYSTEM_ROLE_PERMISSIONS[user.role] || [];
      } else if (user.customRoleId) {
        // Custom role — load from DB
        const role = await Role.findOne({
          _id: user.customRoleId,
          tenantId: user.tenantId,
          deletedAt: null,
        }).lean();
        rolePermissions = role?.permissions || [];
      }

      // Apply individual permission overrides
      const granted = new Set([
        ...rolePermissions,
        ...(user.permissionOverrides?.grant || []),
      ]);

      // Remove explicitly denied permissions
      for (const denied of user.permissionOverrides?.deny || []) {
        granted.delete(denied);
      }

      return Array.from(granted);
    } catch (err) {
      logger.error('Failed to resolve permissions from DB', { userId: user._id, error: err.message });
      return [];
    }
  }

  /**
   * Check if a resolved permission set includes a specific permission.
   * Handles wildcard (*) expansion.
   */
  hasPermission(permissions, required) {
    if (!required) return true;
    if (permissions.includes('*')) return true;
    if (permissions.includes(required)) return true;

    // Resource-level wildcard: "users:*" grants "users:read", "users:write", etc.
    const [resource] = required.split(':');
    return permissions.includes(`${resource}:*`);
  }

  /**
   * Check multiple permissions at once. Returns a map of permission → boolean.
   */
  checkMany(permissions, required = []) {
    return required.reduce((acc, perm) => {
      acc[perm] = this.hasPermission(permissions, perm);
      return acc;
    }, {});
  }

  /**
   * Invalidate the cached permission set for a user.
   * Call this whenever a user's role or overrides change.
   */
  async invalidateCache(userId) {
    const key = cache.keys.userPermissions(userId.toString());
    await cache.del(key);
    logger.debug('Permission cache invalidated', { userId });
  }
}

module.exports = new PermissionEngine();
