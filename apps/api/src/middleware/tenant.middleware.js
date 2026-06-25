'use strict';

const { getMasterConnection } = require('../db/master');
const tenantSchema = require('../models/master/Tenant.model');
const cache = require('../services/cache/CacheService');
const {
  TenantNotFoundError,
  TenantSuspendedError,
  TenantCancelledError,
  TenantProvisioningError,
} = require('../core/errors');
const logger = require('../services/logger');
const config = require('../config/app.config');

/**
 * Tenant Middleware Pipeline
 *
 * Step 1 — extractTenant: Identify tenant from subdomain, header, or JWT
 * Step 2 — validateTenant: Check tenant status and enforce lifecycle rules
 * Step 3 — attachTenant:  Attach resolved tenant to req.tenant
 */

// Lazy Tenant model (master connection must be up)
let TenantModel = null;
const getTenantModel = () => {
  if (!TenantModel) {
    const conn = getMasterConnection();
    try {
      TenantModel = conn.model('Tenant');
    } catch {
      TenantModel = conn.model('Tenant', tenantSchema);
    }
  }
  return TenantModel;
};

/**
 * Resolve tenant slug from the incoming request using multiple strategies:
 * 1. Subdomain:    techcorp.tenantcore.com → slug = "techcorp"
 * 2. Header:       X-Tenant-Slug: techcorp
 * 3. Header (ID):  X-Tenant-Id: <objectId>
 * 4. JWT payload:  token.tenantId (handled later in auth middleware)
 */
function extractSlug(req) {
  // Strategy 1: Nginx injects X-Tenant-Slug from subdomain matching
  const slugFromHeader = req.get('X-Tenant-Slug');
  if (slugFromHeader) return { type: 'slug', value: slugFromHeader.toLowerCase().trim() };

  // Strategy 2: X-Tenant-Id header
  const idFromHeader = req.get('X-Tenant-Id');
  if (idFromHeader) return { type: 'id', value: idFromHeader.trim() };

  // Strategy 3: Parse subdomain from Host header directly
  const host = req.get('host') || '';
  const domainBase = config.app.domainBase;
  const subdomain = host.replace(`.${domainBase}`, '').replace(/:\d+$/, '');

  if (subdomain && subdomain !== domainBase && !subdomain.includes('.')) {
    return { type: 'slug', value: subdomain.toLowerCase() };
  }

  return null;
}

/**
 * tenantMiddleware — Extract and validate tenant for every request.
 * Attaches resolved tenant to req.tenant.
 * Skips if the route is marked as tenant-independent (e.g. /health, /api/admin).
 */
const tenantMiddleware = async (req, res, next) => {
  try {
    const extracted = extractSlug(req);

    // Skip tenant resolution for platform-level endpoints
    if (!extracted) {
      req.tenant = null;
      return next();
    }

    const Tenant = getTenantModel();
    const cacheKey = `cache:tenant:slug:${extracted.value}`;

    // Cache-aside: check Redis first
    let tenant = await cache.get(cacheKey);

    if (!tenant) {
      const query = extracted.type === 'slug'
        ? { slug: extracted.value, deletedAt: null }
        : { _id: extracted.value, deletedAt: null };

      tenant = await Tenant.findOne(query).lean();

      if (tenant) {
        await cache.set(cacheKey, tenant, 120); // 2 minute cache
      }
    }

    if (!tenant) {
      throw new TenantNotFoundError(extracted.value);
    }

    // ── Validate tenant status ────────────────────────────────────────────────
    switch (tenant.status) {
      case 'active':
        break; // Proceed normally

      case 'trial':
        // Allow through, but add expiry header if trialEndsAt is set
        if (tenant.trialEndsAt) {
          res.set('X-Trial-Expires', new Date(tenant.trialEndsAt).toISOString());
        }
        break;

      case 'suspended':
        throw new TenantSuspendedError(tenant.suspension?.reason);

      case 'cancelled':
        throw new TenantCancelledError();

      case 'provisioning':
        throw new TenantProvisioningError();

      default:
        throw new TenantSuspendedError('Unknown tenant status');
    }

    req.tenant = tenant;
    logger.debug('Tenant resolved', { slug: tenant.slug, status: tenant.status });
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { tenantMiddleware, extractSlug };
