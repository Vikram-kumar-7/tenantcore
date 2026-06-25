'use strict';

const { getRedisClient } = require('../redis');
const { getMasterConnection } = require('../../db/master');
const { QUOTA_THRESHOLDS, getQuotaLimit } = require('../../config/plans.config');
const { QuotaExceededError } = require('../../core/errors');
const EventBus = require('../../core/EventBus');
const logger = require('../logger');

/**
 * QuotaEngine — tracks and enforces resource limits per tenant.
 *
 * Tracking strategies:
 *   API requests  → Redis counter (synced to MongoDB hourly)
 *   Storage       → Redis counter updated on file events
 *   Users (seats) → Real-time count from DB
 *   API Keys      → Real-time count from DB
 *   Export records→ Redis counter
 */
class QuotaEngine {
  constructor() {
    this.redis = getRedisClient();
  }

  /**
   * Get current month's quota usage for a tenant.
   */
  async getUsage(tenantId, plan) {
    const month = this._currentMonth();
    const [apiRequests, storage, exportRecords] = await Promise.all([
      this._getCounter(tenantId, 'api_requests', month),
      this._getCounter(tenantId, 'storage_bytes', month),
      this._getCounter(tenantId, 'export_records', month),
    ]);

    const limits = {
      apiRequestsPerMonth: getQuotaLimit(plan, 'apiRequestsPerMonth'),
      storageMB: getQuotaLimit(plan, 'storageMB'),
      exportRecordsPerMonth: getQuotaLimit(plan, 'exportRecordsPerMonth'),
    };

    return {
      plan,
      month,
      usage: {
        apiRequests: { used: apiRequests, limit: limits.apiRequestsPerMonth },
        storageMB: { used: Math.round(storage / 1024 / 1024), limit: limits.storageMB },
        exportRecords: { used: exportRecords, limit: limits.exportRecordsPerMonth },
      },
    };
  }

  /**
   * Check if a specific metric is within quota. Returns status object.
   */
  async check(tenantId, plan, metric) {
    const month = this._currentMonth();
    const limit = getQuotaLimit(plan, metric);
    if (limit === Infinity) return { allowed: true, used: 0, limit: Infinity, percentage: 0 };

    const used = await this._getCounter(tenantId, metric, month);
    const percentage = Math.round((used / limit) * 100);

    return { allowed: used < limit, used, limit, percentage };
  }

  /**
   * Enforce quota for a metric. Throws QuotaExceededError if over limit.
   * Also emits warning/exceeded events at thresholds.
   */
  async enforce(tenantId, plan, metric, incrementBy = 1) {
    const month = this._currentMonth();
    const limit = getQuotaLimit(plan, metric);
    if (limit === Infinity) return; // Unlimited plan

    const key = this._key(tenantId, metric, month);
    const newCount = await this.redis.incrby(key, incrementBy);

    // Set TTL on first increment (expires end of next month)
    if (newCount === incrementBy) {
      await this.redis.expire(key, 35 * 24 * 60 * 60); // ~35 days
    }

    const percentage = Math.round((newCount / limit) * 100);

    if (percentage >= QUOTA_THRESHOLDS.exceeded) {
      EventBus.emit('quota.exceeded', { tenantId, metric });
      throw new QuotaExceededError(metric, limit);
    }

    if (percentage >= QUOTA_THRESHOLDS.warning) {
      // Only emit warning once per threshold crossing (use Redis flag)
      const warnKey = `quota:warned:${tenantId}:${metric}:${month}`;
      const alreadyWarned = await this.redis.set(warnKey, '1', 'EX', 24 * 60 * 60, 'NX');
      if (alreadyWarned === 'OK') {
        EventBus.emit('quota.warning', { tenantId, metric, percentage });
      }
    }
  }

  /**
   * Decrement a quota counter (e.g. when a file is deleted).
   */
  async decrement(tenantId, metric, decrementBy = 1) {
    const month = this._currentMonth();
    const key = this._key(tenantId, metric, month);
    await this.redis.decrby(key, decrementBy);
  }

  /**
   * Reset monthly quotas for all tenants. Called by cron on 1st of month.
   */
  async resetMonthly(tenantId) {
    const month = this._currentMonth();
    const monthlyMetrics = ['api_requests', 'export_records'];
    for (const metric of monthlyMetrics) {
      const key = this._key(tenantId, metric, month);
      await this.redis.set(key, 0);
    }
    logger.info('Monthly quotas reset', { tenantId, month });
  }

  _key(tenantId, metric, month) {
    return `quota:${tenantId}:${metric}:${month}`;
  }

  async _getCounter(tenantId, metric, month) {
    const val = await this.redis.get(this._key(tenantId, metric, month));
    return parseInt(val || '0', 10);
  }

  _currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}

module.exports = new QuotaEngine();
