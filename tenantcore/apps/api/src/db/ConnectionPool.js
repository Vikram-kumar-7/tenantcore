'use strict';

const mongoose = require('mongoose');
const config = require('../config/app.config');
const logger = require('../services/logger');

/**
 * LRU-based tenant connection pool.
 * Manages per-tenant MongoDB connections for the "isolated" DB strategy.
 * Evicts least-recently-used connection when pool is full.
 */
class TenantConnectionPool {
  constructor(maxConnections = 100) {
    this.maxConnections = maxConnections;
    /** @type {Map<string, { connection: mongoose.Connection, lastUsed: number }>} */
    this.pool = new Map();
  }

  /**
   * Return an existing connection for the tenant or open a new one.
   * Updates lastUsed timestamp for LRU tracking.
   */
  async getConnection(tenantId, connectionUri) {
    if (this.pool.has(tenantId)) {
      const entry = this.pool.get(tenantId);
      entry.lastUsed = Date.now();

      // Re-use if still alive
      if (entry.connection.readyState === 1) {
        return entry.connection;
      }

      // Dead connection — remove and reconnect
      logger.warn('Tenant DB connection was dead, reconnecting', { tenantId });
      this.pool.delete(tenantId);
    }

    // Evict LRU if pool is at capacity
    if (this.pool.size >= this.maxConnections) {
      this._evictLRU();
    }

    const conn = await this._openConnection(tenantId, connectionUri);
    this.pool.set(tenantId, { connection: conn, lastUsed: Date.now() });
    return conn;
  }

  /**
   * Open a new mongoose connection to the tenant's database.
   * Tenant DB name: tenantcore_{tenantId}
   */
  async _openConnection(tenantId, overrideUri) {
    // Build URI: either use master URI with tenant DB name, or tenant's own URI
    const baseUri = overrideUri || config.mongodb.masterUri;
    const dbName = `tenantcore_${tenantId.replace(/[^a-zA-Z0-9_]/g, '_')}`;

    // Replace DB name in URI
    const uri = baseUri.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);

    const opts = {
      maxPoolSize: 5,       // Smaller pool per tenant
      minPoolSize: 1,
      socketTimeoutMS: 30_000,
      serverSelectionTimeoutMS: 10_000,
    };

    const conn = await mongoose.createConnection(uri, opts);

    conn.on('error', (err) =>
      logger.error('Tenant DB error', { tenantId, error: err.message })
    );
    conn.on('disconnected', () =>
      logger.warn('Tenant DB disconnected', { tenantId })
    );

    logger.info('Tenant DB connection opened', { tenantId, dbName });
    return conn;
  }

  /**
   * Evict the least-recently-used tenant connection from the pool.
   */
  _evictLRU() {
    let oldest = null;
    let oldestTime = Infinity;

    for (const [tenantId, entry] of this.pool) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldest = tenantId;
      }
    }

    if (oldest) {
      const entry = this.pool.get(oldest);
      entry.connection.close().catch(() => {});
      this.pool.delete(oldest);
      logger.info('Evicted LRU tenant DB connection', { tenantId: oldest });
    }
  }

  /**
   * Close a specific tenant's connection and remove it from the pool.
   */
  async release(tenantId) {
    const entry = this.pool.get(tenantId);
    if (entry) {
      await entry.connection.close();
      this.pool.delete(tenantId);
      logger.info('Tenant DB connection released', { tenantId });
    }
  }

  /**
   * Ping all connections — returns a health map.
   */
  async healthCheck() {
    const results = {};
    for (const [tenantId, entry] of this.pool) {
      try {
        await entry.connection.db.admin().ping();
        results[tenantId] = { status: 'ok', readyState: entry.connection.readyState };
      } catch (err) {
        results[tenantId] = { status: 'error', error: err.message };
      }
    }
    return results;
  }

  /**
   * Stats for monitoring.
   */
  stats() {
    return {
      activeConnections: this.pool.size,
      maxConnections: this.maxConnections,
      tenants: Array.from(this.pool.keys()),
    };
  }

  /**
   * Close all connections (called on graceful shutdown).
   */
  async closeAll() {
    const promises = [];
    for (const [, entry] of this.pool) {
      promises.push(entry.connection.close());
    }
    await Promise.allSettled(promises);
    this.pool.clear();
    logger.info('All tenant DB connections closed');
  }
}

// Singleton pool exported for use throughout the application
const pool = new TenantConnectionPool(100);

module.exports = pool;
