'use strict';

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../middleware/rbac.middleware');

/**
 * Tenant Routes — /api/v1/tenants
 */

router.get('/', requirePermission('settings:read'), async (req, res, next) => {
  try {
    const { tenant } = req.context;
    res.json({ success: true, data: { tenant } });
  } catch (err) { next(err); }
});

router.patch('/settings', requirePermission('settings:write'), async (req, res, next) => {
  try {
    const { tenant, db } = req.context;
    // Settings update logic
    res.json({ success: true, data: { message: 'Settings updated' } });
  } catch (err) { next(err); }
});

module.exports = router;
