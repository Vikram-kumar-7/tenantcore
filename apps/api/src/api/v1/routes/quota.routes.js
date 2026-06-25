'use strict';

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../middleware/rbac.middleware');
const { getPlan } = require('../../../config/plans.config');

// GET /quota — Get current quota usage
router.get('/', requirePermission('quota:read'), async (req, res, next) => {
  try {
    const { tenant } = req.context;
    const QuotaEngine = require('../../../services/quota/QuotaEngine');
    const usage = await QuotaEngine.getUsage(tenant.id.toString(), tenant.plan);
    res.json({ success: true, data: { quota: usage } });
  } catch (err) { next(err); }
});

// GET /quota/check/:metric
router.get('/check/:metric', requirePermission('quota:read'), async (req, res, next) => {
  try {
    const { tenant } = req.context;
    const QuotaEngine = require('../../../services/quota/QuotaEngine');
    const result = await QuotaEngine.check(tenant.id.toString(), tenant.plan, req.params.metric);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

module.exports = router;
