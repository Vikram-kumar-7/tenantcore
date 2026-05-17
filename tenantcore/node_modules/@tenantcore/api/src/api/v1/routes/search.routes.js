'use strict';

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../middleware/rbac.middleware');

// GET /search?q=term&indexes=users,files
router.get('/', requirePermission('search:query'), async (req, res, next) => {
  try {
    const { tenant } = req.context;
    const { q, indexes = 'users,files', limit = 20, offset = 0 } = req.query;
    if (!q) return res.json({ success: true, data: { results: [] } });

    const MeilisearchService = require('../../../services/search/MeilisearchService');
    const results = await MeilisearchService.query(tenant.id.toString(), q, {
      indexes: indexes.split(','),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.json({ success: true, data: { results, query: q } });
  } catch (err) { next(err); }
});

module.exports = router;
