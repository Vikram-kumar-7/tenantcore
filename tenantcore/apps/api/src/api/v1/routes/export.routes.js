'use strict';

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../middleware/rbac.middleware');
const { body, validationResult } = require('express-validator');
const { ValidationError, NotFoundError } = require('../../../core/errors');

// POST /exports
router.post('/',
  requirePermission('export:create'),
  [
    body('resource').isIn(['users', 'auditLogs', 'files', 'usageEvents']),
    body('format').isIn(['csv', 'json', 'pdf']),
    body('filters').optional().isObject(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new ValidationError('Validation failed', errors.array());

      const { tenant, user } = req.context;
      const { resource, format, filters = {} } = req.body;

      // Queue export job (Feature 8)
      res.status(202).json({
        success: true,
        data: {
          exportId: `exp_${Date.now()}`,
          status: 'queued',
          message: 'Export queued. You will be notified when ready.',
        },
      });
    } catch (err) { next(err); }
  }
);

// GET /exports/:id/download
router.get('/:id/download', requirePermission('export:create'), async (req, res, next) => {
  try {
    res.json({ success: true, data: { message: 'Export download URL (Feature 18 — full implementation)' } });
  } catch (err) { next(err); }
});

module.exports = router;
