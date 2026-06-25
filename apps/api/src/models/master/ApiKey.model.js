'use strict';

const mongoose = require('mongoose');

/**
 * ApiKey Model (Master DB)
 * Tenants generate API keys to authenticate machine-to-machine requests.
 * SECURITY: Raw key is NEVER stored. Only SHA-256 hash is persisted.
 */
const apiKeySchema = new mongoose.Schema(
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
      maxlength: 100,
    },

    // SHA-256 hash of the raw key — used for lookup
    keyHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
      select: false, // Never returned in queries
    },

    // First 16 chars of raw key — safe to display, not a secret
    prefix: {
      type: String,
      required: true,
      maxlength: 20,
    },

    // Permissions this key grants
    scopes: {
      type: [String],
      default: [],
    },

    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
      index: true,
    },

    // Usage tracking
    lastUsedAt: { type: Date, default: null },
    usageCount: { type: Number, default: 0 },

    // Optional expiry
    expiresAt: { type: Date, default: null },

    // Audit trail
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    revokedAt: { type: Date, default: null },

    // Soft delete
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'apiKeys',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ───────────────────────────────────────────────────────────────────
apiKeySchema.index({ tenantId: 1, status: 1 });
apiKeySchema.index({ expiresAt: 1 }, { sparse: true });

// ─── Virtuals ──────────────────────────────────────────────────────────────────
apiKeySchema.virtual('isExpired').get(function () {
  return this.expiresAt && this.expiresAt < new Date();
});

apiKeySchema.virtual('isValid').get(function () {
  return this.status === 'active' && !this.isExpired && !this.deletedAt;
});

// ─── Instance Methods ──────────────────────────────────────────────────────────
apiKeySchema.methods.hasScope = function (scope) {
  return this.scopes.includes('*') || this.scopes.includes(scope);
};

apiKeySchema.methods.recordUsage = function () {
  this.lastUsedAt = new Date();
  this.usageCount += 1;
  return this.save();
};

module.exports = apiKeySchema;
