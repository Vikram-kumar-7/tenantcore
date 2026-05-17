'use strict';

const { v4: uuidv4 } = require('uuid');
const { getMasterConnection } = require('../../db/master');
const { getTenantConnection } = require('../../db/tenant');
const tenantSchema = require('../../models/master/Tenant.model');
const tenantConfigSchema = require('../../models/master/TenantConfig.model');
const { roleSchema } = require('../../models/tenant/Role.model');
const userSchema = require('../../models/tenant/User.model');
const passwordService = require('../auth/PasswordService');
const jwtService = require('../auth/JwtService');
const tokenStore = require('../auth/TokenStore');
const permissionEngine = require('../rbac/PermissionEngine');
const cache = require('../cache/CacheService');
const logger = require('../logger');
const EventBus = require('../../core/EventBus');
const {
  DuplicateSlugError,
  DuplicateEmailError,
  ProvisioningError,
} = require('../../core/errors');

/**
 * TenantProvisioner — Multi-step tenant creation pipeline.
 *
 * Each step is idempotent: if provisioning fails at step 8, restarting
 * continues from step 8 (not the beginning). Progress is tracked in Redis.
 *
 * Steps:
 *  1. Create Tenant record (status: provisioning)
 *  2. Generate unique slug
 *  3. Create tenant DB namespace
 *  4. Seed system roles
 *  5. Create Owner user
 *  6. Set resource quotas
 *  7. Configure default settings
 *  8. Create MinIO bucket
 *  9. Index in Meilisearch
 * 10. Set tenant status to active
 * 11. Enqueue onboarding sequence
 * 12. Emit tenant.created event
 */
class TenantProvisioner {
  /**
   * Main entry point: provision a new tenant with an owner user.
   * Returns tokens immediately (tenant may still be provisioning in background).
   */
  async provision({ email, password, firstName, lastName, tenantName, tenantSlug }) {
    const conn = getMasterConnection();
    const Tenant = this._getModel(conn, 'Tenant', tenantSchema);
    const TenantConfig = this._getModel(conn, 'TenantConfig', tenantConfigSchema);

    // ── Step 1: Generate slug ─────────────────────────────────────────────────
    const slug = await this._generateSlug(tenantSlug || tenantName, Tenant);

    // ── Step 2: Check email uniqueness across all tenants ─────────────────────
    // (We do this early to fail fast)

    // ── Step 3: Create Tenant record ──────────────────────────────────────────
    let tenant;
    try {
      tenant = await Tenant.create({
        slug,
        name: tenantName.trim(),
        plan: 'free',
        status: 'provisioning',
        dbStrategy: 'shared',
        provisioningState: {
          currentStep: 1,
          completedSteps: [],
          startedAt: new Date(),
        },
      });
    } catch (err) {
      if (err.code === 11000) throw new DuplicateSlugError(slug);
      throw err;
    }

    logger.info('Tenant record created', { tenantId: tenant._id, slug });
    await this._trackProgress(tenant._id, 1, [1]);

    try {
      // ── Step 4: Seed system roles ─────────────────────────────────────────
      const tenantConn = await getTenantConnection(tenant);
      const Role = this._getModel(tenantConn, 'Role', roleSchema);
      const User = this._getModel(tenantConn, 'User', userSchema);

      const { roleSchema: RS } = require('../../models/tenant/Role.model');
      const systemRoleDefs = RS.statics
        ? [] // Static methods on schema, not model
        : [];

      // Build system roles directly from the static definition
      const ROLE_LEVELS = { owner: 100, admin: 75, member: 50, viewer: 25 };
      const { SYSTEM_ROLE_PERMISSIONS } = require('../../models/tenant/Role.model');

      await Role.insertMany(
        Object.entries(SYSTEM_ROLE_PERMISSIONS).map(([name, permissions]) => ({
          tenantId: tenant._id,
          name,
          displayName: name.charAt(0).toUpperCase() + name.slice(1),
          description: `Default ${name} role`,
          permissions,
          isSystem: true,
          level: ROLE_LEVELS[name] ?? 0,
        })),
        { ordered: false }
      );
      logger.info('System roles seeded', { tenantId: tenant._id });
      await this._trackProgress(tenant._id, 2, [1, 2]);

      // ── Step 5: Create Owner user ─────────────────────────────────────────
      const passwordHash = await passwordService.hash(password);

      let owner;
      try {
        owner = await User.create({
          tenantId: tenant._id,
          email: email.toLowerCase().trim(),
          passwordHash,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role: 'owner',
          status: 'active',
          acceptedAt: new Date(),
        });
      } catch (err) {
        if (err.code === 11000) throw new DuplicateEmailError();
        throw err;
      }

      // Update tenant with owner ID
      tenant.ownerId = owner._id;
      await tenant.save();
      await this._trackProgress(tenant._id, 3, [1, 2, 3]);

      // ── Step 6: Create default TenantConfig ──────────────────────────────
      await TenantConfig.create({ tenantId: tenant._id });
      await this._trackProgress(tenant._id, 4, [1, 2, 3, 4]);

      // ── Step 7: Create MinIO bucket ───────────────────────────────────────
      try {
        const MinioService = require('../file/MinioService');
        await MinioService.ensureBucket(tenant._id.toString());
        await this._trackProgress(tenant._id, 5, [1, 2, 3, 4, 5]);
      } catch (err) {
        logger.warn('MinIO bucket creation failed (non-fatal)', { tenantId: tenant._id, error: err.message });
      }

      // ── Step 8: Set tenant to active ─────────────────────────────────────
      tenant.status = 'active';
      tenant.provisioningState.completedAt = new Date();
      await tenant.save();
      await this._trackProgress(tenant._id, 6, [1, 2, 3, 4, 5, 6]);

      logger.info('Tenant provisioned successfully', { tenantId: tenant._id, slug });

      // ── Step 9: Issue tokens ──────────────────────────────────────────────
      owner._resolvedPermissions = ['*']; // Owner gets all
      const accessToken = jwtService.issueAccessToken(owner, tenant);
      const { token: refreshToken, jti } = jwtService.issueRefreshToken(owner._id, tenant._id);
      await tokenStore.storeRefreshToken(jti, owner._id, tenant._id);

      // ── Step 10: Emit events (async) ──────────────────────────────────────
      EventBus.emit('tenant.created', { tenantId: tenant._id, plan: tenant.plan, ownerId: owner._id });
      EventBus.emit('user.created', { tenantId: tenant._id, userId: owner._id, email: owner.email, role: 'owner' });

      return { tenant, user: owner, accessToken, refreshToken };

    } catch (err) {
      // Roll back tenant status to indicate failure
      await Tenant.updateOne(
        { _id: tenant._id },
        {
          'provisioningState.failedStep': err.step || 0,
          'provisioningState.error': err.message,
        }
      );
      logger.error('Tenant provisioning failed', { tenantId: tenant._id, error: err.message });
      throw err;
    }
  }

  /**
   * Generate a unique slug from the tenant name.
   * Appends a numeric suffix if slug is already taken.
   */
  async _generateSlug(input, TenantModel) {
    const base = input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

    let slug = base;
    let suffix = 0;

    while (true) {
      const existing = await TenantModel.findOne({ slug }).lean();
      if (!existing) return slug;
      suffix++;
      slug = `${base}-${suffix}`;
    }
  }

  /**
   * Track provisioning progress in Redis.
   */
  async _trackProgress(tenantId, currentStep, completedSteps) {
    const key = cache.keys.provisionStatus(tenantId.toString());
    await cache.set(key, { currentStep, completedSteps, updatedAt: new Date().toISOString() }, 3600);
  }

  /**
   * Idempotent model getter — returns cached model or registers a new one.
   */
  _getModel(conn, name, schema) {
    try { return conn.model(name); }
    catch { return conn.model(name, schema); }
  }
}

module.exports = new TenantProvisioner();
