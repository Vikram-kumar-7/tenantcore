'use strict';

const logger = require('../../services/logger');

/**
 * Tenant Event Handlers
 * Reacts to tenant lifecycle events emitted by the EventBus.
 */

const onTenantCreated = async ({ tenantId, plan, ownerId }) => {
  logger.info('Event: tenant.created', { tenantId, plan, ownerId });
  // Queue welcome email, initialize analytics, etc.
  // Queue integration is done via queue-engine (Feature 8)
};

const onTenantSuspended = async ({ tenantId, reason }) => {
  logger.warn('Event: tenant.suspended', { tenantId, reason });
  // Notify owner, log to audit trail
};

const onTenantReactivated = async ({ tenantId }) => {
  logger.info('Event: tenant.reactivated', { tenantId });
};

const onTenantPlanChanged = async ({ tenantId, oldPlan, newPlan }) => {
  logger.info('Event: tenant.plan_changed', { tenantId, oldPlan, newPlan });
  // Invalidate quota caches, update feature flags
  const cache = require('../../services/cache/CacheService');
  await cache.invalidatePattern(cache.keys.tenantAll(tenantId));
};

module.exports = { onTenantCreated, onTenantSuspended, onTenantReactivated, onTenantPlanChanged };
