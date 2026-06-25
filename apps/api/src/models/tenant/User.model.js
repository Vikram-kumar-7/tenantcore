'use strict';

const mongoose = require('mongoose');

/**
 * User Model (Tenant DB)
 * Users belong to a specific tenant. Stored in the tenant's database.
 * Password hash is never returned by default (select: false).
 */
const userSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    passwordHash: {
      type: String,
      required: false, // May be null for SSO users
      select: false,
    },

    firstName: { type: String, trim: true, maxlength: 100 },
    lastName: { type: String, trim: true, maxlength: 100 },
    avatar: { type: String, default: null },
    phone: { type: String, default: null },
    timezone: { type: String, default: 'UTC' },
    locale: { type: String, default: 'en' },

    // Primary role assignment
    role: {
      type: String,
      enum: ['owner', 'admin', 'member', 'viewer'],
      default: 'member',
      index: true,
    },

    // Custom role override (if using tenant-defined roles)
    customRoleId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    // Individual permission overrides on top of role permissions
    permissionOverrides: {
      grant: { type: [String], default: [] },   // Extra permissions
      deny: { type: [String], default: [] },    // Revoked permissions
    },

    status: {
      type: String,
      enum: ['active', 'invited', 'suspended', 'deactivated'],
      default: 'invited',
      index: true,
    },

    // Invitation tracking
    invitedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    inviteToken: { type: String, default: null, select: false },
    inviteExpiresAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },

    // MFA
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String, default: null, select: false },

    // Login tracking
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
    loginCount: { type: Number, default: 0 },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    // Notification preferences
    notificationPreferences: {
      email: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true },
      digest: { type: Boolean, default: true },
      types: {
        security: { type: Boolean, default: true },
        billing: { type: Boolean, default: true },
        updates: { type: Boolean, default: true },
      },
    },

    // Soft delete
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  {
    timestamps: true,
    collection: 'users',
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.passwordHash;
        delete ret.mfaSecret;
        delete ret.inviteToken;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// ─── Compound Indexes ───────────────────────────────────────────────────────────
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });
userSchema.index({ tenantId: 1, role: 1 });
userSchema.index({ tenantId: 1, status: 1 });
userSchema.index({ tenantId: 1, deletedAt: 1 });

// ─── Virtuals ──────────────────────────────────────────────────────────────────
userSchema.virtual('fullName').get(function () {
  return [this.firstName, this.lastName].filter(Boolean).join(' ') || this.email;
});

userSchema.virtual('isActive').get(function () {
  return this.status === 'active' && !this.deletedAt;
});

userSchema.virtual('isLocked').get(function () {
  return this.lockedUntil && this.lockedUntil > new Date();
});

// ─── Instance Methods ──────────────────────────────────────────────────────────
userSchema.methods.incrementFailedLogin = async function () {
  this.failedLoginAttempts += 1;
  if (this.failedLoginAttempts >= 5) {
    this.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
  }
  return this.save();
};

userSchema.methods.resetFailedLogin = async function () {
  this.failedLoginAttempts = 0;
  this.lockedUntil = null;
  this.lastLoginAt = new Date();
  this.loginCount += 1;
  return this.save();
};

// ─── Query Middleware ──────────────────────────────────────────────────────────
// Automatically exclude soft-deleted users from all queries
userSchema.pre(/^find/, function (next) {
  if (!this.getOptions().withDeleted) {
    this.where({ deletedAt: null });
  }
  next();
});

// ─── Static Methods ────────────────────────────────────────────────────────────
userSchema.statics.findWithDeleted = function (filter) {
  return this.find(filter).setOptions({ withDeleted: true });
};

userSchema.statics.findByEmail = function (tenantId, email) {
  return this.findOne({ tenantId, email: email.toLowerCase() });
};

module.exports = userSchema;
module.exports.schema = userSchema;
