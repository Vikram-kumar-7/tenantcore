'use strict';

const logger = require('../services/logger');

/**
 * Audit Log Middleware
 *
 * Logs every significant request asynchronously (non-blocking).
 * Fires after the response is sent — never delays the response.
 *
 * Only logs requests that match auditable patterns (not health checks, metrics, etc.).
 */

// Events mapped by HTTP method + route pattern
const AUDITABLE_ACTIONS = {
  'POST /api/v1/auth/login': 'auth.login',
  'POST /api/v1/auth/logout': 'auth.logout',
  'POST /api/v1/auth/signup': 'auth.signup',
  'POST /api/v1/auth/refresh': 'auth.token_refresh',
  'POST /api/v1/users': 'user.created',
  'DELETE /api/v1/users/:id': 'user.deleted',
  'PATCH /api/v1/users/:id/role': 'user.role_changed',
  'POST /api/v1/apikeys': 'apikey.created',
  'DELETE /api/v1/apikeys/:id': 'apikey.revoked',
  'POST /api/v1/roles': 'role.created',
  'PATCH /api/v1/roles/:id': 'role.updated',
  'DELETE /api/v1/roles/:id': 'role.deleted',
  'POST /api/v1/files/upload-url': 'file.upload_requested',
  'POST /api/v1/files/:id/confirm': 'file.uploaded',
  'DELETE /api/v1/files/:id': 'file.deleted',
  'PATCH /api/v1/tenants/settings': 'tenant.settings_updated',
  'POST /api/v1/exports': 'export.created',
};

// Paths to skip entirely
const SKIP_PATHS = ['/health', '/readiness', '/liveness', '/metrics', '/api/docs'];

/**
 * Determine the audit action string for a request.
 * Returns null if this request should not be audited.
 */
function resolveAction(req) {
  if (SKIP_PATHS.some((p) => req.path.startsWith(p))) return null;

  // Normalize path by replacing IDs with :id
  const normalizedPath = req.path.replace(/\/[a-f0-9]{24}/g, '/:id');
  const key = `${req.method} ${normalizedPath}`;

  return AUDITABLE_ACTIONS[key] || null;
}

/**
 * auditMiddleware — Attaches the _logAudit helper to the response.
 * Actual logging is triggered in the 'finish' event so it never blocks.
 */
const auditMiddleware = (req, res, next) => {
  const startTime = Date.now();

  res.on('finish', () => {
    const action = resolveAction(req);
    if (!action) return;

    // Skip successful GETs (reads are only logged on explicit audit endpoints)
    if (req.method === 'GET' && res.statusCode < 400) return;

    const context = req.context;

    setImmediate(async () => {
      try {
        const { db, tenant, user } = context || {};
        if (!db?.AuditLog) return;

        const entry = {
          tenantId: tenant?.id,
          userId: user?.id || null,
          userEmail: user?.email || null,
          action: res.statusCode >= 400 ? `${action}.failed` : action,
          resource: req._auditResource || null,
          changes: req._auditChanges || null,
          metadata: {
            ip: req.ip,
            userAgent: req.get('user-agent'),
            requestId: req.requestId,
            duration: Date.now() - startTime,
            statusCode: res.statusCode,
          },
          severity: res.statusCode >= 500
            ? 'critical'
            : res.statusCode >= 400
              ? 'warning'
              : 'info',
        };

        await db.AuditLog.create(entry);
      } catch (err) {
        // Audit log failures must NEVER crash the server
        logger.warn('Audit log write failed', { error: err.message, action });
      }
    });
  });

  next();
};

/**
 * Helper to attach audit metadata to a request from controller code.
 * Usage: req.setAuditResource({ type: 'user', id: user._id, name: user.email })
 */
const attachAuditHelpers = (req, res, next) => {
  req.setAuditResource = (resource) => { req._auditResource = resource; };
  req.setAuditChanges = (before, after) => { req._auditChanges = { before, after }; };
  next();
};

module.exports = { auditMiddleware, attachAuditHelpers };
