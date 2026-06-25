'use strict';

const logger = require('../../services/logger');
const permissionEngine = require('../../services/rbac/PermissionEngine');

/**
 * User Event Handlers
 */

const onUserCreated = async ({ tenantId, userId, email, role }) => {
  logger.info('Event: user.created', { tenantId, userId, email, role });
  // Index in Meilisearch (Feature 17), send invite email via queue (Feature 8)
};

const onUserRoleChanged = async ({ tenantId, userId, oldRole, newRole }) => {
  logger.info('Event: user.role_changed', { tenantId, userId, oldRole, newRole });
  // Invalidate permission cache so next request gets fresh permissions
  await permissionEngine.invalidateCache(userId);
};

const onUserLogin = async ({ tenantId, userId, ip }) => {
  logger.info('Event: user.login', { tenantId, userId, ip });
};

const onUserDeleted = async ({ tenantId, userId }) => {
  logger.info('Event: user.deleted', { tenantId, userId });
  // Remove from search index, clean up sessions
  await permissionEngine.invalidateCache(userId);
};

module.exports = { onUserCreated, onUserRoleChanged, onUserLogin, onUserDeleted };
