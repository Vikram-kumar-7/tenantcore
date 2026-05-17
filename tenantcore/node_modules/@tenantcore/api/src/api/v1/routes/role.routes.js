'use strict';

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../middleware/rbac.middleware');
const { body, validationResult } = require('express-validator');
const { ValidationError, NotFoundError } = require('../../../core/errors');
const { roleSchema, SYSTEM_ROLE_PERMISSIONS } = require('../../../models/tenant/Role.model');
const EventBus = require('../../../core/EventBus');

/**
 * Role Routes — /api/v1/roles
 */

// GET /roles — List all roles for tenant
router.get('/', requirePermission('roles:manage'), async (req, res, next) => {
  try {
    const { db, tenant } = req.context;
    const roles = await db.Role.find({ tenantId: tenant.id, deletedAt: null }).lean();
    res.json({ success: true, data: { roles } });
  } catch (err) { next(err); }
});

// GET /roles/:id
router.get('/:id', requirePermission('roles:manage'), async (req, res, next) => {
  try {
    const { db, tenant } = req.context;
    const role = await db.Role.findOne({ _id: req.params.id, tenantId: tenant.id }).lean();
    if (!role) throw new NotFoundError('Role');
    res.json({ success: true, data: { role } });
  } catch (err) { next(err); }
});

// POST /roles — Create custom role
router.post('/',
  requirePermission('roles:manage'),
  [
    body('name').notEmpty().trim().toLowerCase(),
    body('displayName').notEmpty().trim(),
    body('permissions').isArray(),
    body('description').optional().trim(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new ValidationError('Validation failed', errors.array());

      const { db, tenant, user } = req.context;
      const { name, displayName, permissions, description } = req.body;

      const existing = await db.Role.findOne({ tenantId: tenant.id, name });
      if (existing) throw new ValidationError(`Role '${name}' already exists`);

      const role = await db.Role.create({
        tenantId: tenant.id,
        name,
        displayName,
        description,
        permissions,
        isSystem: false,
        createdBy: user.id,
      });

      req.setAuditResource?.({ type: 'role', id: role._id, name: role.displayName });
      EventBus.emit('role.created', { tenantId: tenant.id, roleId: role._id });

      res.status(201).json({ success: true, data: { role } });
    } catch (err) { next(err); }
  }
);

// PATCH /roles/:id — Update role permissions
router.patch('/:id',
  requirePermission('roles:manage'),
  [body('permissions').optional().isArray(), body('displayName').optional().trim()],
  async (req, res, next) => {
    try {
      const { db, tenant } = req.context;
      const role = await db.Role.findOne({ _id: req.params.id, tenantId: tenant.id });
      if (!role) throw new NotFoundError('Role');
      if (role.isSystem) throw new ValidationError('System roles cannot be modified');

      const before = { permissions: role.permissions, displayName: role.displayName };

      if (req.body.permissions) role.permissions = req.body.permissions;
      if (req.body.displayName) role.displayName = req.body.displayName;
      await role.save();

      req.setAuditChanges?.(before, { permissions: role.permissions, displayName: role.displayName });
      EventBus.emit('role.updated', { tenantId: tenant.id, roleId: role._id, changes: req.body });

      res.json({ success: true, data: { role } });
    } catch (err) { next(err); }
  }
);

// DELETE /roles/:id
router.delete('/:id', requirePermission('roles:manage'), async (req, res, next) => {
  try {
    const { db, tenant, user } = req.context;
    const role = await db.Role.findOne({ _id: req.params.id, tenantId: tenant.id });
    if (!role) throw new NotFoundError('Role');
    if (role.isSystem) throw new ValidationError('System roles cannot be deleted');

    role.deletedAt = new Date();
    role.deletedBy = user.id;
    await role.save();

    res.json({ success: true, data: { message: 'Role deleted' } });
  } catch (err) { next(err); }
});

module.exports = router;
