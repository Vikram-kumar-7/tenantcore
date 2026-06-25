'use strict';

const mongoose = require('mongoose');

/**
 * UsageEvent Model (Tenant DB)
 * Metered usage events for quota tracking (API calls, storage, exports).
 * High-write collection — optimized for append-only workloads.
 */
const usageEventSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    metric: {
      type: String,
      required: true,
      enum: [
        'api_request',
        'storage_used',
        'storage_freed',
        'export_record',
        'user_seat',
        'user_seat_freed',
        'api_key_created',
        'api_key_revoked',
      ],
      index: true,
    },

    // Magnitude of the event (1 for API request, bytes for storage)
    value: {
      type: Number,
      required: true,
      default: 1,
    },

    // Month this event belongs to (YYYY-MM) for easy monthly aggregation
    month: {
      type: String,
      required: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // Optional: which resource triggered this event
    resourceType: { type: String, default: null },
    resourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'usageEvents',
  }
);

// ─── Compound Indexes ───────────────────────────────────────────────────────────
usageEventSchema.index({ tenantId: 1, metric: 1, month: 1 });
usageEventSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = usageEventSchema;
module.exports.schema = usageEventSchema;
