'use strict';

const mongoose = require('mongoose');

/**
 * TenantConfig Model (Master DB)
 * Per-tenant configuration overrides that sit on top of global defaults and plan defaults.
 * One document per tenant — upserted as settings change.
 */
const tenantConfigSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },

    auth: {
      sessionDuration: { type: Number, default: 900 },      // seconds
      maxLoginAttempts: { type: Number, default: 5 },
      mfaRequired: { type: Boolean, default: false },
      allowedDomains: { type: [String], default: [] },      // Email domain whitelist
      passwordMinLength: { type: Number, default: 8 },
    },

    files: {
      maxFileSizeMB: { type: Number, default: 10 },
      allowedMimeTypes: {
        type: [String],
        default: ['image/*', 'application/pdf'],
      },
      virusScanEnabled: { type: Boolean, default: false },
      autoDeleteAfterDays: { type: Number, default: null }, // null = never
    },

    notifications: {
      emailEnabled: { type: Boolean, default: true },
      inAppEnabled: { type: Boolean, default: true },
      digestEnabled: { type: Boolean, default: true },
      digestDay: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        default: 'friday',
      },
    },

    rateLimit: {
      requestsPerMinute: { type: Number, default: null }, // null = use plan default
      burstMultiplier: { type: Number, default: null },
    },

    // Feature flag overrides for this specific tenant
    features: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Retention policies in days
    retention: {
      auditLogs: { type: Number, default: 90 },
      users: { type: Number, default: 30 },
      files: { type: Number, default: 30 },
      apiKeys: { type: Number, default: 7 },
      exports: { type: Number, default: 3 },
    },

    // IP allowlist (plugin: ip-allowlist)
    ipAllowlist: {
      enabled: { type: Boolean, default: false },
      ips: { type: [String], default: [] },
    },

    // Custom webhook endpoints
    webhooks: {
      enabled: { type: Boolean, default: false },
      endpoints: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },

    // SSO config stub
    sso: {
      enabled: { type: Boolean, default: false },
      provider: { type: String, default: null },
      config: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
  },
  {
    timestamps: true,
    collection: 'tenantConfigs',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = tenantConfigSchema;
