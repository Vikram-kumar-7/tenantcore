'use strict';

const { getMasterConnection } = require('./master');
const connectionPool = require('./ConnectionPool');

/**
 * Get the correct Mongoose connection for a given tenant based on its dbStrategy.
 *
 * Strategies:
 *   shared     → single master DB, tenantId filter on every query
 *   isolated   → dedicated DB per tenant, managed by TenantConnectionPool
 *   dedicated  → tenant has their own MongoDB server (Enterprise)
 */
async function getTenantConnection(tenant) {
  switch (tenant.dbStrategy) {
    case 'isolated':
      return connectionPool.getConnection(tenant.id, null);

    case 'dedicated':
      // Dedicated server URI stored encrypted in tenant config
      if (!tenant.dedicatedMongoUri) {
        throw new Error(`Tenant ${tenant.id} is on dedicated strategy but has no dedicatedMongoUri`);
      }
      return connectionPool.getConnection(tenant.id, tenant.dedicatedMongoUri);

    case 'shared':
    default:
      // Shared strategy uses master connection; tenantId field enforces isolation
      return getMasterConnection();
  }
}

module.exports = { getTenantConnection };
