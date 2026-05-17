'use strict';

const mongoose = require('mongoose');

/**
 * Role Model (Tenant DB)
 * System roles (owner/admin/member/viewer) + custom tenant-defined roles.
 * Permissions follow resource:action pattern.
 */

// Default permission sets for system roles
const SYSTEM_ROLE_PERMISSIONS = {
  owner: ['*'],
  admin: [
    'users:read', 'users:write', 'users:delete',
    'roles:manage',
    'billing:read',
    'reports:export',
    'files:upload',
    'apikeys:manage',
    'settings:read', 'settings:write',
    'notifications:read',
    'audit:read',
    'search:query',
    'export:create',
    'quota:read',
    'webhooks:manage',
    'plugins:manage',
  ],
  member: [
    'users:read',
    'reports:export',
    'files:upload',
    'settings:read',
    'notifications:read',
    'search:query',
    'export:create',
    'quota:read',
  ],
  viewer: [
    'users:read',
    'settings:read',
    'notifications:read',
    'search:query',
    'quota:read',
  ],
};

const roleSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
    },

    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    description: {
      type: String,
      default: '',
      maxlength: 500,
    },

    // Array of permission strings: "resource:action"
    permissions: {
      type: [String],
      default: [],
    },

    // System roles cannot be deleted or have their permissions modified (only extended)
    isSystem: {
      type: Boolean,
      default: false,
    },

    // Hierarchy level: owner > admin > member > viewer (for requireRole checks)
    level: {
      type: Number,
      default: 0,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // Soft delete
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  {
    timestamps: true,
    collection: 'roles',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ────────────────────────────────────────────────────────────────────
roleSchema.index({ tenantId: 1, name: 1 }, { unique: true });
roleSchema.index({ tenantId: 1, isSystem: 1 });

// ─── Instance Methods ───────────────────────────────────────────────────────────
roleSchema.methods.hasPermission = function (permission) {
  return this.permissions.includes('*') || this.permissions.includes(permission);
};

// ─── Static Methods ─────────────────────────────────────────────────────────────
roleSchema.statics.getSystemPermissions = function (roleName) {
  return SYSTEM_ROLE_PERMISSIONS[roleName] ?? [];
};

roleSchema.statics.buildSystemRoles = function (tenantId) {
  const ROLE_LEVELS = { owner: 100, admin: 75, member: 50, viewer: 25 };

  return Object.entries(SYSTEM_ROLE_PERMISSIONS).map(([name, permissions]) => ({
    tenantId,
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    description: `Default ${name} role`,
    permissions,
    isSystem: true,
    level: ROLE_LEVELS[name] ?? 0,
  }));
};

module.exports = { roleSchema, SYSTEM_ROLE_PERMISSIONS };
module.exports.schema = roleSchema;
