'use strict';

const mongoose = require('mongoose');

/**
 * File Model (Tenant DB)
 * Metadata for files stored in MinIO. The actual binary is in MinIO;
 * this model tracks ownership, status, and usage against quotas.
 */
const fileSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    // UUID generated at upload-url request time
    fileId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    originalName: {
      type: String,
      required: true,
      maxlength: 500,
    },

    // Stored with UUID prefix to avoid collisions
    storedName: {
      type: String,
      required: true,
    },

    mimeType: {
      type: String,
      required: true,
    },

    size: {
      type: Number,    // bytes
      required: true,
      min: 0,
    },

    extension: {
      type: String,
      maxlength: 20,
    },

    // MinIO location
    bucket: {
      type: String,
      required: true,
    },

    key: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ['pending', 'uploaded', 'deleted'],
      default: 'pending',
      index: true,
    },

    isPublic: { type: Boolean, default: false },

    // Optional auto-expiry for temporary files
    expiresAt: { type: Date, default: null },

    // Custom metadata tags (e.g. { project: 'alpha', version: '2' })
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Virus scan result
    virusScan: {
      scanned: { type: Boolean, default: false },
      clean: { type: Boolean, default: null },
      scannedAt: { type: Date, default: null },
    },

    uploadedAt: { type: Date, default: null },

    // Soft delete
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  {
    timestamps: true,
    collection: 'files',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ────────────────────────────────────────────────────────────────────
fileSchema.index({ tenantId: 1, status: 1 });
fileSchema.index({ tenantId: 1, uploadedBy: 1 });
fileSchema.index({ tenantId: 1, deletedAt: 1 });

// ─── Virtuals ──────────────────────────────────────────────────────────────────
fileSchema.virtual('sizeMB').get(function () {
  return (this.size / (1024 * 1024)).toFixed(2);
});

fileSchema.virtual('isExpired').get(function () {
  return this.expiresAt && this.expiresAt < new Date();
});

// ─── Query Middleware ──────────────────────────────────────────────────────────
fileSchema.pre(/^find/, function (next) {
  if (!this.getOptions().withDeleted) {
    this.where({ deletedAt: null });
  }
  next();
});

fileSchema.statics.findWithDeleted = function (filter) {
  return this.find(filter).setOptions({ withDeleted: true });
};

module.exports = fileSchema;
module.exports.schema = fileSchema;
