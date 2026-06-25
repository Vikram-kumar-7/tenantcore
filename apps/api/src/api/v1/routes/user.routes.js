'use strict';

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../middleware/rbac.middleware');
const { body, validationResult } = require('express-validator');
const { ValidationError, NotFoundError, DuplicateEmailError } = require('../../../core/errors');
const passwordService = require('../../../services/auth/PasswordService');
const EventBus = require('../../../core/EventBus');

/**
 * User Routes — /api/v1/users
 */

// GET /users — List all users in tenant
router.get('/', requirePermission('users:read'), async (req, res, next) => {
  try {
    const { db, tenant } = req.context;
    const { page = 1, limit = 20, role, status, search } = req.query;

    const filter = { tenantId: tenant.id };
    if (role) filter.role = role;
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [users, total] = await Promise.all([
      db.User.find(filter).select('-passwordHash -mfaSecret -inviteToken').lean()
        .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      db.User.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: { users },
      pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / limit) },
      meta: { requestId: req.requestId, timestamp: new Date().toISOString() },
    });
  } catch (err) { next(err); }
});

// GET /users/:id
router.get('/:id', requirePermission('users:read'), async (req, res, next) => {
  try {
    const { db, tenant } = req.context;
    const user = await db.User.findOne({ _id: req.params.id, tenantId: tenant.id }).lean();
    if (!user) throw new NotFoundError('User');
    res.json({ success: true, data: { user } });
  } catch (err) { next(err); }
});

// POST /users — Invite user
router.post('/', requirePermission('users:write'),
  [
    body('email').isEmail().normalizeEmail(),
    body('role').isIn(['admin', 'member', 'viewer']),
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new ValidationError('Validation failed', errors.array());

      const { db, tenant, user: actor } = req.context;
      const { email, role, firstName, lastName } = req.body;

      const existing = await db.User.findOne({ tenantId: tenant.id, email });
      if (existing) throw new DuplicateEmailError();

      const newUser = await db.User.create({
        tenantId: tenant.id,
        email,
        role,
        firstName,
        lastName,
        status: 'invited',
        invitedBy: actor.id,
      });

      req.setAuditResource?.({ type: 'user', id: newUser._id, name: email });
      EventBus.emit('user.created', { tenantId: tenant.id, userId: newUser._id, email, role });

      res.status(201).json({ success: true, data: { user: newUser } });
    } catch (err) { next(err); }
  }
);

// PATCH /users/:id/role
router.patch('/:id/role', requirePermission('users:write'), async (req, res, next) => {
  try {
    const { db, tenant, user: actor } = req.context;
    const { role } = req.body;

    if (!['admin', 'member', 'viewer'].includes(role)) {
      throw new ValidationError('Invalid role');
    }

    const targetUser = await db.User.findOne({ _id: req.params.id, tenantId: tenant.id });
    if (!targetUser) throw new NotFoundError('User');

    const oldRole = targetUser.role;
    targetUser.role = role;
    await targetUser.save();

    req.setAuditChanges?.({ role: oldRole }, { role });
    EventBus.emit('user.role_changed', { tenantId: tenant.id, userId: targetUser._id, oldRole, newRole: role });

    res.json({ success: true, data: { user: targetUser } });
  } catch (err) { next(err); }
});

// DELETE /users/:id
router.delete('/:id', requirePermission('users:delete'), async (req, res, next) => {
  try {
    const { db, tenant, user: actor } = req.context;
    const targetUser = await db.User.findOne({ _id: req.params.id, tenantId: tenant.id });
    if (!targetUser) throw new NotFoundError('User');

    targetUser.deletedAt = new Date();
    targetUser.deletedBy = actor.id;
    await targetUser.save();

    EventBus.emit('user.deleted', { tenantId: tenant.id, userId: targetUser._id });
    res.json({ success: true, data: { message: 'User deleted' } });
  } catch (err) { next(err); }
});

// POST /users/:id/restore
router.post('/:id/restore', requirePermission('users:write'), async (req, res, next) => {
  try {
    const { db, tenant } = req.context;
    const user = await db.User.findWithDeleted({ _id: req.params.id, tenantId: tenant.id }).findOne();
    if (!user) throw new NotFoundError('User');

    user.deletedAt = null;
    user.deletedBy = null;
    await user.save();

    res.json({ success: true, data: { message: 'User restored' } });
  } catch (err) { next(err); }
});

module.exports = router;
