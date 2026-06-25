'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { requireSuperAdmin } = require('../../middleware/rbac.middleware');
const { getMasterConnection } = require('../../db/master');
const tenantSchema = require('../../models/master/Tenant.model');
const connectionPool = require('../../db/ConnectionPool');

// All admin routes require authentication + super admin role
router.use(authenticate, requireSuperAdmin);

function getTenant() {
  const conn = getMasterConnection();
  try { return conn.model('Tenant'); } catch { return conn.model('Tenant', tenantSchema); }
}

// GET /api/admin/tenants
router.get('/tenants', async (req, res, next) => {
  try {
    const Tenant = getTenant();
    const { status, plan, page = 1, limit = 50 } = req.query;
    const filter = { deletedAt: null };
    if (status) filter.status = status;
    if (plan) filter.plan = plan;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [tenants, total] = await Promise.all([
      Tenant.find(filter).lean().sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Tenant.countDocuments(filter),
    ]);
    res.json({ success: true, data: { tenants }, pagination: { page: +page, limit: +limit, total } });
  } catch (err) { next(err); }
});

// GET /api/admin/tenants/:id
router.get('/tenants/:id', async (req, res, next) => {
  try {
    const Tenant = getTenant();
    const tenant = await Tenant.findById(req.params.id).lean();
    if (!tenant) return res.status(404).json({ success: false, error: { message: 'Tenant not found' } });
    res.json({ success: true, data: { tenant } });
  } catch (err) { next(err); }
});

// POST /api/admin/tenants/:id/suspend
router.post('/tenants/:id/suspend', async (req, res, next) => {
  try {
    const Tenant = getTenant();
    const { reason = 'Suspended by admin' } = req.body;
    const tenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { status: 'suspended', suspension: { reason, suspendedAt: new Date(), suspendedBy: req.user._id } },
      { new: true }
    );
    if (!tenant) return res.status(404).json({ success: false, error: { message: 'Tenant not found' } });

    const EventBus = require('../../core/EventBus');
    EventBus.emit('tenant.suspended', { tenantId: tenant._id, reason });

    res.json({ success: true, data: { tenant } });
  } catch (err) { next(err); }
});

// POST /api/admin/tenants/:id/restore
router.post('/tenants/:id/restore', async (req, res, next) => {
  try {
    const Tenant = getTenant();
    const tenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { status: 'active', $unset: { suspension: 1 } },
      { new: true }
    );
    if (!tenant) return res.status(404).json({ success: false, error: { message: 'Tenant not found' } });

    const EventBus = require('../../core/EventBus');
    EventBus.emit('tenant.reactivated', { tenantId: tenant._id });

    res.json({ success: true, data: { tenant } });
  } catch (err) { next(err); }
});

// GET /api/admin/workers
router.get('/workers', async (req, res, next) => {
  try {
    const { getRedisClient } = require('../../services/redis');
    const redis = getRedisClient();
    const keys = await redis.keys('worker:heartbeat:*');
    const workers = await Promise.all(
      keys.map(async (key) => {
        const data = await redis.get(key);
        return data ? { workerId: key.replace('worker:heartbeat:', ''), ...JSON.parse(data) } : null;
      })
    );
    res.json({ success: true, data: { workers: workers.filter(Boolean) } });
  } catch (err) { next(err); }
});

// GET /api/admin/metrics
router.get('/metrics', async (req, res, next) => {
  try {
    const poolStats = connectionPool.stats();
    const mem = process.memoryUsage();
    res.json({
      success: true,
      data: {
        process: {
          uptime: process.uptime(),
          memoryMB: Math.round(mem.heapUsed / 1024 / 1024),
          pid: process.pid,
        },
        connections: poolStats,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/admin/health
router.get('/health', async (req, res, next) => {
  try {
    const { pingMaster } = require('../../db/master');
    const { pingRedis } = require('../../services/redis');
    const [dbLatency, redisLatency] = await Promise.all([pingMaster(), pingRedis()]);
    res.json({
      success: true,
      data: {
        status: 'healthy',
        mongodb: { status: 'ok', latencyMs: dbLatency },
        redis: { status: 'ok', latencyMs: redisLatency },
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
