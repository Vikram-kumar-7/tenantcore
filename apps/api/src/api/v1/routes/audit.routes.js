'use strict';

const express = require('express');
const router = express.Router();

// GET /audit — Query audit logs
router.get('/', async (req, res, next) => {
  try {
    const { db, tenant } = req.context;
    const { page = 1, limit = 50, action, userId, severity, from, to } = req.query;

    const filter = { tenantId: tenant.id };
    if (action) filter.action = new RegExp(action, 'i');
    if (userId) filter.userId = userId;
    if (severity) filter.severity = severity;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      db.AuditLog.find(filter).lean().sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      db.AuditLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: { logs },
      pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / parseInt(limit)) },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) { next(err); }
});

module.exports = router;
