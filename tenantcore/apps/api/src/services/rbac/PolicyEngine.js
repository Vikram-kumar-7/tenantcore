'use strict';

const permissionEngine = require('./PermissionEngine');
const { PermissionDeniedError } = require('../../core/errors');
const logger = require('../logger');

/**
 * PolicyEngine — central authorization layer.
 * Combines RBAC (permission checks) with context-aware policies.
 *
 * Policies are functions that evaluate whether a user can perform
 * an action on a resource, given the full request context.
 *
 * Evaluation order: RBAC permission check → Policy evaluation
 */
class PolicyEngine {
  constructor() {
    /** @type {Map<string, Function>} */
    this.policies = new Map();
    this._registerDefaultPolicies();
  }

  /**
   * Register a named policy function.
   * Policy signature: (user, resource, context) => boolean | Promise<boolean>
   */
  define(name, policyFn) {
    this.policies.set(name, policyFn);
    return this;
  }

  /**
   * Evaluate a policy. Returns true if allowed, throws PermissionDeniedError otherwise.
   */
  async evaluate(policyName, user, resource, context) {
    const policy = this.policies.get(policyName);
    if (!policy) {
      logger.warn('Unknown policy evaluated — defaulting to deny', { policyName });
      throw new PermissionDeniedError(`Policy '${policyName}' is not defined`);
    }

    const allowed = await policy(user, resource, context);
    if (!allowed) {
      throw new PermissionDeniedError(`Policy '${policyName}' denied access`);
    }
    return true;
  }

  /**
   * Check a policy without throwing — returns boolean.
   */
  async check(policyName, user, resource, context) {
    try {
      await this.evaluate(policyName, user, resource, context);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Register all built-in policies.
   */
  _registerDefaultPolicies() {
    // Users can only edit their own profile, unless admin+
    this.define('edit_user_profile', (user, targetUser) => {
      if (['owner', 'admin'].includes(user.role)) return true;
      return user._id.toString() === targetUser._id.toString();
    });

    // Users can only delete themselves or (if admin) other users
    this.define('delete_user', (user, targetUser) => {
      if (user.role === 'owner') return true;
      if (user.role === 'admin') {
        // Admins cannot delete owners
        return targetUser.role !== 'owner';
      }
      return false;
    });

    // Files can only be deleted by uploader or admin+
    this.define('delete_file', (user, file) => {
      if (['owner', 'admin'].includes(user.role)) return true;
      return file.uploadedBy?.toString() === user._id.toString();
    });

    // API keys can be revoked by their creator or admin+
    this.define('revoke_apikey', (user, apiKey) => {
      if (['owner', 'admin'].includes(user.role)) return true;
      return apiKey.createdBy?.toString() === user._id.toString();
    });

    // Exports only allowed during business hours for free plan
    this.define('create_export', (user, resource, context) => {
      if (context?.tenant?.plan !== 'free') return true;
      const hour = new Date().getHours();
      return hour >= 9 && hour <= 17;
    });

    // Only owners can change the tenant plan
    this.define('change_plan', (user) => user.role === 'owner');

    // Only owners can delete the tenant workspace
    this.define('delete_tenant', (user) => user.role === 'owner');

    // Owners and admins can manage roles
    this.define('manage_roles', (user) => ['owner', 'admin'].includes(user.role));

    // System roles cannot be deleted
    this.define('delete_role', (user, role) => {
      if (role.isSystem) return false;
      return ['owner', 'admin'].includes(user.role);
    });
  }
}

module.exports = new PolicyEngine();
