'use strict';

const mongoose = require('mongoose');

/**
 * Notification Model (Tenant DB)
 * In-app and email notifications per user per tenant.
 */
const notificationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ['info', 'warning', 'error', 'success'],
      required: true,
    },

    title: {
      type: String,
      required: true,
      maxlength: 200,
    },

    message: {
      type: String,
      required: true,
      maxlength: 2000,
    },

    // Arbitrary payload for deep-linking in the frontend
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },

    channel: {
      type: String,
      enum: ['in-app', 'email', 'both'],
      default: 'in-app',
    },

    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal',
    },

    // Optional auto-expire (e.g. dismiss trial warning after trial ends)
    expiresAt: { type: Date, default: null },

    // Was it delivered via WebSocket? (for offline queue tracking)
    delivered: { type: Boolean, default: false },
    deliveredAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'notifications',
  }
);

// ─── Indexes ────────────────────────────────────────────────────────────────────
notificationSchema.index({ tenantId: 1, userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true }); // TTL index

module.exports = notificationSchema;
module.exports.schema = notificationSchema;
