'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requirePermission } = require('../../../middleware/rbac.middleware');
const { body, validationResult } = require('express-validator');
const { ValidationError, NotFoundError, QuotaExceededError } = require('../../../core/errors');
const { getMasterConnection } = require('../../../db/master');
const apiKeySchema = require('../../../models/master/ApiKey.model');
const { getPlan } = require('../../../config/plans.config');
const EventBus = require('../../../core/EventBus');

function getApiKeyModel() {
  const conn = getMasterConnection();
  try { return conn.model('ApiKey'); }
  catch { return conn.model('ApiKey', apiKeySchema); }
}

/**
 * API Key Routes — /api/v1/apikeys
 * Keys are stored in master DB (not tenant DB) for cross-request lookup speed.
 */

// GET /apikeys — List tenant's API keys
router.get('/', requirePermission('apikeys:manage'), async (req, res, next) => {
  try {
    const { tenant } = req.context;
    const ApiKey = getApiKeyModel();
    const keys = await ApiKey.find({ tenantId: tenant.id, deletedAt: null })
      .select('-keyHash').lean();
    res.json({ success: true, data: { apiKeys: keys } });
  } catch (err) { next(err); }
});

// POST /apikeys — Create new API key
router.post('/',
  requirePermission('apikeys:manage'),
  [
    body('name').notEmpty().trim().withMessage('Key name is required'),
    body('scopes').isArray().withMessage('Scopes must be an array'),
    body('expiresAt').optional().isISO8601(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new ValidationError('Validation failed', errors.array());

      const { tenant, user } = req.context;
      const ApiKey = getApiKeyModel();

      // Check quota
      const plan = getPlan(tenant.plan);
      const existingCount = await ApiKey.countDocuments({ tenantId: tenant.id, status: 'active' });
      if (existingCount >= plan.quotas.apiKeys) {
        throw new QuotaExceededError('apiKeys', plan.quotas.apiKeys);
      }

      // Generate the raw key: tc_live_ + 32 random bytes as hex = 64 hex chars
      const rawBytes = crypto.randomBytes(32).toString('hex');
      const rawKey = `tc_live_${rawBytes}`;
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const prefix = rawKey.slice(0, 16); // First 16 chars for display

      const apiKey = await ApiKey.create({
        tenantId: tenant.id,
        name: req.body.name,
        keyHash,
        prefix,
        scopes: req.body.scopes,
        expiresAt: req.body.expiresAt || null,
        createdBy: user.id,
      });

      req.setAuditResource?.({ type: 'apikey', id: apiKey._id, name: apiKey.name });
      EventBus.emit('apikey.created', { tenantId: tenant.id, keyId: apiKey._id });

      // Return raw key ONLY on creation — never stored, never returned again
      res.status(201).json({
        success: true,
        data: {
          apiKey: {
            id: apiKey._id,
            name: apiKey.name,
            prefix: apiKey.prefix,
            scopes: apiKey.scopes,
            expiresAt: apiKey.expiresAt,
            createdAt: apiKey.createdAt,
          },
          rawKey, // ← shown ONCE only
          warning: 'Save this key now. It will not be shown again.',
        },
      });
    } catch (err) { next(err); }
  }
);

// DELETE /apikeys/:id — Revoke
router.delete('/:id', requirePermission('apikeys:manage'), async (req, res, next) => {
  try {
    const { tenant, user } = req.context;
    const ApiKey = getApiKeyModel();

    const apiKey = await ApiKey.findOne({ _id: req.params.id, tenantId: tenant.id });
    if (!apiKey) throw new NotFoundError('API Key');

    apiKey.status = 'revoked';
    apiKey.revokedBy = user.id;
    apiKey.revokedAt = new Date();
    await apiKey.save();

    // Invalidate API key cache
    const cache = require('../../../services/cache/CacheService');
    // We don't have the hash here but TTL will expire within 5 minutes
    req.setAuditResource?.({ type: 'apikey', id: apiKey._id, name: apiKey.name });
    EventBus.emit('apikey.revoked', { tenantId: tenant.id, keyId: apiKey._id });

    res.json({ success: true, data: { message: 'API key revoked' } });
  } catch (err) { next(err); }
});

module.exports = router;
