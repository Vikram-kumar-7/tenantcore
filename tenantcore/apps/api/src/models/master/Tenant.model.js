'use strict';

const mongoose = require('mongoose');

/**
 * Tenant Model (Master DB)
 * Every tenant (company workspace) is stored here.
 * This is the source of truth for tenant identity and configuration.
 */
const tenantSchema = new mongoose.Schema(
  {
    // Human-readable unique identifier used in subdomains: techcorp.tenantcore.com
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    plan: {
      type: String,
      enum: ['free', 'starter', 'pro', 'enterprise'],
      default: 'free',
      index: true,
    },

    status: {
      type: String,
      enum: ['provisioning', 'active', 'trial', 'suspended', 'cancelled'],
      default: 'provisioning',
      index: true,
    },

    // Trial expiry date — only relevant when status === 'trial'
    trialEndsAt: {
      type: Date,
      default: null,
    },

    // Suspension details
    suspension: {
      reason: String,
      suspendedAt: Date,
      suspendedBy: String, // userId or 'system'
    },

    // Database isolation strategy
    dbStrategy: {
      type: String,
      enum: ['shared', 'isolated', 'dedicated'],
      default: 'shared',
    },

    // Only populated for 'dedicated' strategy — stored encrypted
    dedicatedMongoUri: {
      type: String,
      default: null,
      select: false, // Never returned in queries by default
    },

    // Tenant branding
    branding: {
      logoUrl: { type: String, default: null },
      primaryColor: { type: String, default: '#6366f1' },
      accentColor: { type: String, default: '#8b5cf6' },
      favicon: { type: String, default: null },
      customDomain: { type: String, default: null },
      emailFrom: { type: String, default: null },
    },

    // Flexible settings object — per-feature configuration
    settings: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Owner user ID (stored after provisioning)
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // Provisioning progress tracking
    provisioningState: {
      currentStep: { type: Number, default: 0 },
      completedSteps: { type: [Number], default: [] },
      failedStep: { type: Number, default: null },
      startedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      error: { type: String, default: null },
    },

    // Metadata
    industry: String,
    size: {
      type: String,
      enum: ['1-10', '11-50', '51-200', '201-1000', '1000+'],
    },
    country: String,
    timezone: { type: String, default: 'UTC' },

    // Soft delete
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'tenants',

    // Virtual fields
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ───────────────────────────────────────────────────────────────────
tenantSchema.index({ slug: 1 }, { unique: true });
tenantSchema.index({ status: 1, plan: 1 });
tenantSchema.index({ createdAt: -1 });
tenantSchema.index({ deletedAt: 1 });

// ─── Virtuals ──────────────────────────────────────────────────────────────────
tenantSchema.virtual('isActive').get(function () {
  return this.status === 'active';
});

tenantSchema.virtual('isTrial').get(function () {
  return this.status === 'trial';
});

tenantSchema.virtual('isTrialExpired').get(function () {
  return this.status === 'trial' && this.trialEndsAt && this.trialEndsAt < new Date();
});

// ─── Instance Methods ──────────────────────────────────────────────────────────
tenantSchema.methods.canReceiveRequests = function () {
  return ['active', 'trial'].includes(this.status);
};

tenantSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.dedicatedMongoUri;
  delete obj.provisioningState;
  return obj;
};

// ─── Static Methods ────────────────────────────────────────────────────────────
tenantSchema.statics.findBySlug = function (slug) {
  return this.findOne({ slug: slug.toLowerCase(), deletedAt: null });
};

tenantSchema.statics.findActive = function () {
  return this.find({ status: { $in: ['active', 'trial'] }, deletedAt: null });
};

module.exports = tenantSchema;
