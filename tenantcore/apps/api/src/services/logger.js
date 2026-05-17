'use strict';

require('dotenv').config();
const winston = require('winston');
const config = require('../config/app.config');

/**
 * Winston logger with structured JSON output.
 * In development: pretty-printed, colorized console output.
 * In production: JSON to file + batched HTTP transport to Loki.
 */

// ─── Custom log format ────────────────────────────────────────────────────────
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const devFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, service, tenantId, requestId, ...rest }) => {
    const extras = Object.keys(rest).length
      ? ' ' + JSON.stringify(rest, null, 0)
      : '';
    const ctx = [tenantId && `tenant=${tenantId}`, requestId && `req=${requestId}`]
      .filter(Boolean)
      .join(' ');
    return `${timestamp} [${level}]${ctx ? ` (${ctx})` : ''} ${message}${extras}`;
  })
);

// ─── Transports ───────────────────────────────────────────────────────────────
const transports = [];

// Console transport (always active)
transports.push(
  new winston.transports.Console({
    format: config.isDev ? devFormat : structuredFormat,
    handleExceptions: true,
  })
);

// File transports (always active — rotated daily by naming convention)
if (!config.isDev) {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: structuredFormat,
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 14,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: structuredFormat,
      maxsize: 20 * 1024 * 1024,
      maxFiles: 7,
    })
  );
}

// Loki transport in production (optional — skip if LOKI_HOST not configured)
if (config.isProd && config.loki.host) {
  try {
    const LokiTransport = require('winston-loki');
    transports.push(
      new LokiTransport({
        host: config.loki.host,
        labels: { app: 'tenantcore-api', env: config.env },
        json: true,
        format: structuredFormat,
        replaceTimestamp: true,
        onConnectionError: (err) => console.error('[Loki] Connection error:', err.message),
        batching: true,
        interval: 5, // seconds
      })
    );
  } catch {
    console.warn('[Logger] winston-loki not available, skipping Loki transport');
  }
}

// ─── Logger instance ──────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: config.isDev ? 'debug' : 'info',
  defaultMeta: {
    service: 'api',
    environment: config.env,
    version: config.app.version,
  },
  transports,
  exitOnError: false,
});

/**
 * Create a child logger with request-scoped context.
 * Use this inside request handlers: const log = logger.child({ tenantId, requestId });
 */
logger.createRequestLogger = (context) => logger.child(context);

/**
 * HTTP request logger middleware (Morgan-compatible stream).
 */
logger.stream = {
  write: (message) => logger.http(message.trim()),
};

module.exports = logger;
