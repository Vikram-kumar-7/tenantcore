'use strict';

/**
 * Custom error hierarchy for TenantCore.
 * Every domain error extends AppError so the global error handler
 * can discriminate between operational errors and programmer bugs.
 */

// ─── Base Error ───────────────────────────────────────────────────────────────

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true; // Distinguishes from unexpected programmer errors
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

// ─── 400 Validation / Bad Request ─────────────────────────────────────────────

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, 400, 'BAD_REQUEST');
  }
}

// ─── 401 Authentication ───────────────────────────────────────────────────────

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_REQUIRED');
  }
}

class InvalidTokenError extends AppError {
  constructor(message = 'Invalid or expired token') {
    super(message, 401, 'INVALID_TOKEN');
  }
}

class InvalidCredentialsError extends AppError {
  constructor(message = 'Invalid email or password') {
    super(message, 401, 'INVALID_CREDENTIALS');
  }
}

// ─── 403 Authorization ────────────────────────────────────────────────────────

class PermissionDeniedError extends AppError {
  constructor(permission = null) {
    const msg = permission
      ? `You do not have permission: ${permission}`
      : 'Permission denied';
    super(msg, 403, 'PERMISSION_DENIED', permission ? { required: permission } : null);
  }
}

class AccountLockedError extends AppError {
  constructor(until = null) {
    super('Account is temporarily locked due to too many failed login attempts', 403, 'ACCOUNT_LOCKED', { until });
  }
}

// ─── 404 Not Found ────────────────────────────────────────────────────────────

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

class TenantNotFoundError extends AppError {
  constructor(slug = null) {
    super(slug ? `Tenant '${slug}' not found` : 'Tenant not found', 404, 'TENANT_NOT_FOUND');
  }
}

class UserNotFoundError extends AppError {
  constructor() {
    super('User not found', 404, 'USER_NOT_FOUND');
  }
}

// ─── 409 Conflict ─────────────────────────────────────────────────────────────

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
  }
}

class DuplicateEmailError extends AppError {
  constructor() {
    super('A user with this email already exists', 409, 'DUPLICATE_EMAIL');
  }
}

class DuplicateSlugError extends AppError {
  constructor(slug) {
    super(`Tenant slug '${slug}' is already taken`, 409, 'DUPLICATE_SLUG');
  }
}

// ─── 410 Gone ────────────────────────────────────────────────────────────────

class TenantCancelledError extends AppError {
  constructor() {
    super('This workspace no longer exists', 410, 'TENANT_CANCELLED');
  }
}

// ─── 422 Unprocessable ────────────────────────────────────────────────────────

class UnprocessableError extends AppError {
  constructor(message) {
    super(message, 422, 'UNPROCESSABLE');
  }
}

// ─── 429 Rate Limit / Quota ───────────────────────────────────────────────────

class RateLimitError extends AppError {
  constructor(retryAfter = null) {
    super('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED', { retryAfter });
    this.retryAfter = retryAfter;
  }
}

class QuotaExceededError extends AppError {
  constructor(metric, limit) {
    super(
      `Quota exceeded for '${metric}'. Limit: ${limit}`,
      429,
      'QUOTA_EXCEEDED',
      { metric, limit }
    );
    this.metric = metric;
    this.limit = limit;
  }
}

// ─── 503 Unavailable ─────────────────────────────────────────────────────────

class TenantSuspendedError extends AppError {
  constructor(reason = null) {
    super('This workspace has been suspended', 403, 'TENANT_SUSPENDED', { reason });
  }
}

class TenantProvisioningError extends AppError {
  constructor() {
    super('This workspace is still being set up. Please try again in a moment.', 503, 'TENANT_PROVISIONING');
  }
}

class ServiceUnavailableError extends AppError {
  constructor(service = 'Service') {
    super(`${service} is temporarily unavailable`, 503, 'SERVICE_UNAVAILABLE');
  }
}

// ─── Provisioning ─────────────────────────────────────────────────────────────

class ProvisioningError extends AppError {
  constructor(step, message) {
    super(`Provisioning failed at step ${step}: ${message}`, 500, 'PROVISIONING_ERROR', { step });
    this.step = step;
  }
}

// ─── File / Storage ──────────────────────────────────────────────────────────

class FileTooLargeError extends AppError {
  constructor(maxSizeMB) {
    super(`File exceeds maximum allowed size of ${maxSizeMB}MB`, 413, 'FILE_TOO_LARGE', { maxSizeMB });
  }
}

class InvalidFileTypeError extends AppError {
  constructor(mimeType) {
    super(`File type '${mimeType}' is not allowed`, 415, 'INVALID_FILE_TYPE', { mimeType });
  }
}

module.exports = {
  AppError,
  ValidationError,
  BadRequestError,
  AuthenticationError,
  InvalidTokenError,
  InvalidCredentialsError,
  PermissionDeniedError,
  AccountLockedError,
  NotFoundError,
  TenantNotFoundError,
  UserNotFoundError,
  ConflictError,
  DuplicateEmailError,
  DuplicateSlugError,
  TenantCancelledError,
  UnprocessableError,
  RateLimitError,
  QuotaExceededError,
  TenantSuspendedError,
  TenantProvisioningError,
  ServiceUnavailableError,
  ProvisioningError,
  FileTooLargeError,
  InvalidFileTypeError,
};
