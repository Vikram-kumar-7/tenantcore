'use strict';

const express = require('express');
const router = express.Router();

// Webhook routes stub (Feature 33 — webhooks plugin)
router.get('/', async (req, res) => {
  res.json({ success: true, data: { webhooks: [], message: 'Webhooks plugin (Feature 33)' } });
});

module.exports = router;
