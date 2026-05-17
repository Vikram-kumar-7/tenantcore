'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth.middleware');
const { requirePermission, requireRole } = require('../../middleware/rbac.middleware');
const { tenantRateLimit } = require('../../middleware/rateLimit.middleware');
const requestScopeMiddleware = require('../../middleware/requestScope.middleware');

// Import all route modules
const authRoutes = require('./routes/auth.routes');
const tenantRoutes = require('./routes/tenant.routes');
const userRoutes = require('./routes/user.routes');
const roleRoutes = require('./routes/role.routes');
const apiKeyRoutes = require('./routes/apiKey.routes');
const fileRoutes = require('./routes/file.routes');
const notificationRoutes = require('./routes/notification.routes');
const searchRoutes = require('./routes/search.routes');
const exportRoutes = require('./routes/export.routes');
const quotaRoutes = require('./routes/quota.routes');
const auditRoutes = require('./routes/audit.routes');
const webhookRoutes = require('./routes/webhook.routes');

// ── Auth routes — public, no rate limit, no scope injection ──────────────────
router.use('/auth', authRoutes);

// ── All routes below: authenticate → inject scope → rate limit → route ────────
// requestScopeMiddleware injects req.context (tenant-scoped DB models) after
// auth has set req.user and tenant middleware has set req.tenant.
const protectedMiddleware = [authenticate, requestScopeMiddleware, tenantRateLimit];

router.use('/tenants', ...protectedMiddleware, tenantRoutes);
router.use('/users', ...protectedMiddleware, userRoutes);
router.use('/roles', ...protectedMiddleware, roleRoutes);
router.use('/apikeys', ...protectedMiddleware, apiKeyRoutes);
router.use('/files', ...protectedMiddleware, fileRoutes);
router.use('/notifications', ...protectedMiddleware, notificationRoutes);
router.use('/search', ...protectedMiddleware, searchRoutes);
router.use('/exports', ...protectedMiddleware, exportRoutes);
router.use('/quota', ...protectedMiddleware, quotaRoutes);
router.use('/audit', ...protectedMiddleware, requirePermission('audit:read'), auditRoutes);
router.use('/webhooks', ...protectedMiddleware, webhookRoutes);

module.exports = router;
