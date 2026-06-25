'use strict';

/**
 * Subscription plan definitions.
 * Every limit the quota engine, rate limiter, and provisioner needs lives here.
 * Adding a new plan = adding a new entry. No other file needs to change.
 */

const PLANS = {
  free: {
    name: 'Free',
    displayName: 'Free Plan',
    price: 0,

    // Rate limiting
    rateLimit: {
      requestsPerMinute: 100,
      window: 60,
      burstMultiplier: 1.2,
    },

    // Quotas — monthly resets where noted
    quotas: {
      apiRequestsPerMonth: 10_000,
      storageMB: 1_024,           // 1 GB
      seats: 3,
      apiKeys: 2,
      exportRecordsPerMonth: 1_000,
    },

    // File upload
    files: {
      maxFileSizeMB: 5,
      allowedMimeTypes: ['image/*', 'application/pdf', 'text/*'],
    },

    // Feature flags enabled by default for this plan
    features: {
      'advanced-search': false,
      'websocket-analytics': false,
      'file-virus-scan': false,
      'api-versioning-v2': true,
      'export-pdf': false,
      'tenant-migration': false,
      'plugin-system': false,
      'two-factor-auth': false,
    },
  },

  starter: {
    name: 'Starter',
    displayName: 'Starter Plan',
    price: 29,

    rateLimit: {
      requestsPerMinute: 500,
      window: 60,
      burstMultiplier: 1.5,
    },

    quotas: {
      apiRequestsPerMonth: 100_000,
      storageMB: 10_240,          // 10 GB
      seats: 10,
      apiKeys: 10,
      exportRecordsPerMonth: 10_000,
    },

    files: {
      maxFileSizeMB: 50,
      allowedMimeTypes: ['image/*', 'application/pdf', 'text/*', 'video/*', 'audio/*'],
    },

    features: {
      'advanced-search': true,
      'websocket-analytics': false,
      'file-virus-scan': false,
      'api-versioning-v2': true,
      'export-pdf': true,
      'tenant-migration': false,
      'plugin-system': false,
      'two-factor-auth': false,
    },
  },

  pro: {
    name: 'Pro',
    displayName: 'Pro Plan',
    price: 99,

    rateLimit: {
      requestsPerMinute: 2_000,
      window: 60,
      burstMultiplier: 2.0,
    },

    quotas: {
      apiRequestsPerMonth: 1_000_000,
      storageMB: 102_400,         // 100 GB
      seats: 100,
      apiKeys: Infinity,
      exportRecordsPerMonth: 100_000,
    },

    files: {
      maxFileSizeMB: 500,
      allowedMimeTypes: ['*'],
    },

    features: {
      'advanced-search': true,
      'websocket-analytics': true,
      'file-virus-scan': true,
      'api-versioning-v2': true,
      'export-pdf': true,
      'tenant-migration': true,
      'plugin-system': false,
      'two-factor-auth': true,
    },
  },

  enterprise: {
    name: 'Enterprise',
    displayName: 'Enterprise Plan',
    price: null, // Custom pricing

    rateLimit: {
      requestsPerMinute: 10_000,
      window: 60,
      burstMultiplier: 3.0,
    },

    quotas: {
      apiRequestsPerMonth: Infinity,
      storageMB: Infinity,
      seats: Infinity,
      apiKeys: Infinity,
      exportRecordsPerMonth: Infinity,
    },

    files: {
      maxFileSizeMB: Infinity,
      allowedMimeTypes: ['*'],
    },

    features: {
      'advanced-search': true,
      'websocket-analytics': true,
      'file-virus-scan': true,
      'api-versioning-v2': true,
      'export-pdf': true,
      'tenant-migration': true,
      'plugin-system': true,
      'two-factor-auth': true,
    },
  },
};

/**
 * Quota warning thresholds — percentage of quota consumed.
 */
const QUOTA_THRESHOLDS = {
  warning: 80,   // Emit quota.warning event
  exceeded: 100, // Emit quota.exceeded event, block operation
};

/**
 * Per-endpoint special rate limits (login, signup, etc.)
 */
const SPECIAL_RATE_LIMITS = {
  login: { requests: 5, window: 15 * 60 },       // 5 per 15 minutes per IP
  signup: { requests: 3, window: 60 * 60 },       // 3 per hour per IP
  passwordReset: { requests: 3, window: 60 * 60 }, // 3 per hour per email
};

/**
 * Get plan config. Falls back to free if plan not found.
 */
const getPlan = (planName) => PLANS[planName] ?? PLANS.free;

/**
 * Get quota limit for a specific metric within a plan.
 */
const getQuotaLimit = (planName, metric) => getPlan(planName).quotas[metric] ?? 0;

module.exports = { PLANS, QUOTA_THRESHOLDS, SPECIAL_RATE_LIMITS, getPlan, getQuotaLimit };
