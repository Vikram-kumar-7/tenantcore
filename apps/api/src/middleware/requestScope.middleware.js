'use strict';

const { v4: uuidv4 } = require('uuid');
const { getTenantConnection } = require('../db/tenant');
const { getMasterConnection } = require('../db/master');

/**
 * requestScope.middleware.js
 *
 * Injects req.context after tenant middleware has set req.tenant and
 * auth middleware has set req.user.
 *
 * Attaches tenant-scoped Mongoose models to req.context.db so that
 * controllers never need to worry about which connection to use.
 */
const requestScopeMiddleware = async (req, res, next) => {
  try {
    const tenant = req.tenant;
    const user = req.user || null;

    // Determine correct DB connection for this tenant's isolation strategy
    let tenantConn;
    if (tenant) {
      tenantConn = await getTenantConnection(tenant);
    } else {
      tenantConn = getMasterConnection();
    }

    /**
     * Idempotent model getter — registers schema only on first call per connection.
     */
    function getModel(name, schemaFactory) {
      try {
        return tenantConn.model(name);
      } catch {
        const schema = schemaFactory();
        return tenantConn.model(name, schema);
      }
    }

    // Lazy-load schemas to avoid circular dependency issues at module load time
    const { schema: userSchema } = require('../models/tenant/User.model');
    const { schema: roleSchema } = require('../models/tenant/Role.model');
    const { schema: auditLogSchema } = require('../models/tenant/AuditLog.model');
    const { schema: notificationSchema } = require('../models/tenant/Notification.model');
    const { schema: fileSchema } = require('../models/tenant/File.model');
    const { schema: usageEventSchema } = require('../models/tenant/UsageEvent.model');

    const db = {
      connection: tenantConn,
      User: getModel('User', () => userSchema),
      Role: getModel('Role', () => roleSchema),
      AuditLog: getModel('AuditLog', () => auditLogSchema),
      Notification: getModel('Notification', () => notificationSchema),
      File: getModel('File', () => fileSchema),
      UsageEvent: getModel('UsageEvent', () => usageEventSchema),
    };

    req.context = {
      tenant: tenant
        ? {
            id: tenant._id,
            slug: tenant.slug,
            plan: tenant.plan,
            dbStrategy: tenant.dbStrategy,
            settings: tenant.settings || {},
            branding: tenant.branding || {},
          }
        : null,

      user: user
        ? {
            id: user._id,
            email: user.email,
            role: user.role,
            fullName: user.firstName ? `${user.firstName} ${user.lastName}` : user.email,
            resolvedPermissions: user._resolvedPermissions || [],
          }
        : null,

      db,
      requestId: req.requestId || uuidv4(),
      startTime: req.startTime || Date.now(),
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('user-agent'),
    };

    req.requestId = req.context.requestId;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = requestScopeMiddleware;
