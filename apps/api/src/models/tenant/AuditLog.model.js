'use strict';

const mongoose = require('mongoose');

/**
 * AuditLog Model (Tenant DB)
 * Immutable record of every significant action in a tenant's workspace.
 * No update or delete operations are permitted on these records.
 */
const auditLogSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    userEmail: {
      type: String,
      default: null,
    },

    // Action identifier: "auth.login", "user.role_changed", etc.
    action: {
      type: String,
      required: true,
      index: true,
    },

    // Resource that was acted upon
    resource: {
      type: { type: String },    // "user", "file", "apikey", etc.
      id: mongoose.Schema.Types.ObjectId,
      name: String,
    },

    // Before/after state for update operations
    changes: {
      before: { type: mongoose.Schema.Types.Mixed, default: null },
      after: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    // Request metadata
    metadata: {
      ip: String,
      userAgent: String,
      requestId: String,
      country: String,
    },

    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'info',
      index: true,
    },

    // Audit logs are append-only — never soft-deleted
    // Auto-purged by cron based on tenant retention policy
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // No updatedAt — immutable
    collection: 'auditLogs',

    // Prevent any updates to audit log documents
    strict: true,
  }
);

// ─── Indexes (optimized for time-range + filter queries) ────────────────────────
auditLogSchema.index({ tenantId: 1, createdAt: -1 });
auditLogSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
auditLogSchema.index({ tenantId: 1, action: 1, createdAt: -1 });
auditLogSchema.index({ tenantId: 1, severity: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: 1 }); // TTL-style purge queries

// ─── Guard: Prevent Updates ─────────────────────────────────────────────────────
auditLogSchema.pre('findOneAndUpdate', function () {
  throw new Error('AuditLog records are immutable and cannot be updated.');
});
auditLogSchema.pre('updateOne', function () {
  throw new Error('AuditLog records are immutable and cannot be updated.');
});
auditLogSchema.pre('updateMany', function () {
  throw new Error('AuditLog records are immutable and cannot be updated.');
});

module.exports = auditLogSchema;
module.exports.schema = auditLogSchema;
