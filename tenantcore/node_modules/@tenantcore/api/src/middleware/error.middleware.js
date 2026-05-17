'use strict';

const logger = require('../services/logger');
const { AppError } = require('../core/errors');

/**
 * Global Error Handler Middleware
 *
 * This MUST be the last middleware registered in Express.
 * It normalizes all errors into a consistent JSON response format.
 *
 * - AppError (isOperational=true):  predictable user-facing errors → structured JSON
 * - Mongoose errors:                mapped to 400/409 responses
 * - JWT errors:                     mapped to 401
 * - All other errors:               500 Internal Server Error (no details leaked)
 */

const errorMiddleware = (err, req, res, next) => {
  // If response already started, delegate to default Express handler
  if (res.headersSent) {
    return next(err);
  }

  const requestId = req.requestId || req.context?.requestId;
  const tenantId = req.context?.tenant?.id;
  const userId = req.context?.user?.id;

  // ── Normalize error ─────────────────────────────────────────────────────────

  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details = null;
  let isOperational = false;

  if (err instanceof AppError) {
    // Our own error classes — safe to expose
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
    isOperational = true;
  } else if (err.name === 'ValidationError' && err.errors) {
    // Mongoose validation error
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    isOperational = true;
  } else if (err.code === 11000) {
    // Mongoose duplicate key error
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    statusCode = 409;
    code = 'DUPLICATE_KEY';
    message = `Duplicate value for field: ${field}`;
    isOperational = true;
  } else if (err.name === 'CastError') {
    // Mongoose invalid ObjectId
    statusCode = 400;
    code = 'INVALID_ID';
    message = `Invalid value for field: ${err.path}`;
    isOperational = true;
  } else if (err.name === 'SyntaxError' && err.status === 400) {
    // JSON parse error
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Request body contains invalid JSON';
    isOperational = true;
  } else if (err.name === 'PayloadTooLargeError') {
    statusCode = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request payload is too large';
    isOperational = true;
  }

  // ── Log the error ───────────────────────────────────────────────────────────

  const logPayload = {
    requestId,
    tenantId,
    userId,
    statusCode,
    code,
    path: req.path,
    method: req.method,
    error: err.message,
  };

  if (!isOperational || statusCode >= 500) {
    // Unexpected errors or server errors — log full stack
    logger.error('Unhandled error', { ...logPayload, stack: err.stack });
  } else {
    // Operational errors — info/warn only
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    logger[level]('Request error', logPayload);
  }

  // ── Build response ──────────────────────────────────────────────────────────

  const body = {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };

  // In development, include stack trace for debugging
  if (process.env.NODE_ENV === 'development' && !isOperational) {
    body.error.stack = err.stack;
  }

  res.status(statusCode).json(body);
};

/**
 * 404 handler — must be registered BEFORE errorMiddleware but AFTER all routes.
 */
const notFoundMiddleware = (req, res, next) => {
  const { AppError: AE } = require('../core/errors');
  next(new AE(`Cannot ${req.method} ${req.path}`, 404, 'NOT_FOUND'));
};

module.exports = { errorMiddleware, notFoundMiddleware };
