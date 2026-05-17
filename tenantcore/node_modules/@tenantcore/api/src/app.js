'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const config = require('./config/app.config');
const logger = require('./services/logger');
const { errorMiddleware, notFoundMiddleware } = require('./middleware/error.middleware');
const { tenantMiddleware } = require('./middleware/tenant.middleware');
const { auditMiddleware, attachAuditHelpers } = require('./middleware/audit.middleware');

// Route modules
const v1Routes = require('./api/v1/index');

// Prometheus metrics (singleton registry)
const client = require('prom-client');
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status', 'tenantId'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'tenantId'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Exported so SocketServer can update it without circular imports
const activeWebsocketConnections = new client.Gauge({
  name: 'active_websocket_connections',
  help: 'Active WebSocket connections',
  registers: [register],
});

/**
 * Create and configure the Express application.
 * Returns both the app and the Prometheus register so server.js can wire up Socket.io.
 */
function createApp() {
  const app = express();

  // ── Request ID injection ────────────────────────────────────────────────────
  app.use((req, res, next) => {
    req.requestId = req.get('X-Request-ID') || uuidv4();
    req.startTime = Date.now();
    res.set('X-Request-ID', req.requestId);
    next();
  });

  // ── Security headers ─────────────────────────────────────────────────────────
  app.use(helmet({ contentSecurityPolicy: config.isProd, crossOriginEmbedderPolicy: false }));

  // ── CORS ─────────────────────────────────────────────────────────────────────
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || config.cors.origins.includes(origin) || config.isDev) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Slug', 'X-API-Key', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  }));

  // ── Body parsing ─────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(compression());

  // ── HTTP request logging ─────────────────────────────────────────────────────
  app.use(morgan('combined', { stream: logger.stream, skip: (req) => req.path === '/health' }));

  // ── Prometheus instrumentation ───────────────────────────────────────────────
  app.use((req, res, next) => {
    res.on('finish', () => {
      const duration = (Date.now() - req.startTime) / 1000;
      const route = req.route?.path || req.path;
      const tenantId = req.tenant?._id?.toString() || 'unknown';
      httpRequestsTotal.inc({ method: req.method, route, status: res.statusCode, tenantId });
      httpRequestDuration.observe({ method: req.method, route, tenantId }, duration);
    });
    next();
  });

  // ── System endpoints (no tenant middleware) ──────────────────────────────────
  app.get('/health', (_req, res) => res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: config.app.version,
  }));

  app.get('/readiness', async (_req, res) => {
    const checks = {};
    let allOk = true;
    try {
      const { pingMaster } = require('./db/master');
      checks.mongodb = { status: 'ok', latency: await pingMaster() };
    } catch (err) {
      checks.mongodb = { status: 'error', error: err.message };
      allOk = false;
    }
    try {
      const { pingRedis } = require('./services/redis');
      checks.redis = { status: 'ok', latency: await pingRedis() };
    } catch (err) {
      checks.redis = { status: 'error', error: err.message };
      allOk = false;
    }
    try {
      const MinioService = require('./services/file/MinioService');
      checks.minio = { status: 'ok', latency: await MinioService.ping() };
    } catch (err) {
      checks.minio = { status: 'degraded', error: err.message };
    }
    res.status(allOk ? 200 : 503).json({ status: allOk ? 'ready' : 'not_ready', checks });
  });

  app.get('/liveness', (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
      status: 'alive',
      memoryUsage: {
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
        rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
      },
      uptime: Math.floor(process.uptime()),
    });
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // ── Swagger API docs (dev only) ──────────────────────────────────────────────
  if (!config.isProd) {
    try {
      const swaggerJsdoc = require('swagger-jsdoc');
      const swaggerUi = require('swagger-ui-express');
      const swaggerSpec = swaggerJsdoc({
        definition: {
          openapi: '3.0.0',
          info: { title: 'TenantCore API', version: config.app.version },
          servers: [{ url: `${config.app.baseUrl}/api/v1` }],
          components: {
            securitySchemes: {
              bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
              apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
            },
          },
        },
        apis: ['./src/api/**/*.js'],
      });
      app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
      app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));
    } catch (err) {
      logger.warn('Swagger init failed', { error: err.message });
    }
  }

  // ── Tenant resolution middleware ─────────────────────────────────────────────
  // Runs on all /api/* routes. Sets req.tenant (or null for platform routes).
  app.use('/api', tenantMiddleware);

  // ── Audit helpers (attach before routes so controllers can call req.setAuditResource) ──
  app.use('/api', attachAuditHelpers);
  app.use('/api', auditMiddleware);

  // ── API Routes ───────────────────────────────────────────────────────────────
  app.use('/api/v1', v1Routes);

  // ── Admin Routes ─────────────────────────────────────────────────────────────
  const adminRoutes = require('./api/admin/index');
  app.use('/api/admin', adminRoutes);

  // ── 404 + global error handler ───────────────────────────────────────────────
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}

module.exports = { createApp, activeWebsocketConnections, prometheusRegister: register };
