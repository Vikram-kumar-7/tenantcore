'use strict';

require('dotenv').config();

const http = require('http');
const config = require('./src/config/app.config');
const logger = require('./src/services/logger');
const { createApp } = require('./src/app');
const { connectMaster, closeMaster } = require('./src/db/master');
const { closeAllRedis, getRedisClient } = require('./src/services/redis');
const connectionPool = require('./src/db/ConnectionPool');
const EventBus = require('./src/core/EventBus');

// ─── Optional OpenTelemetry tracing ──────────────────────────────────────────
if (config.isProd && process.env.OTEL_ENABLED === 'true') {
  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { Resource } = require('@opentelemetry/resources');
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'tenantcore-api',
        [SemanticResourceAttributes.SERVICE_VERSION]: config.app.version,
      }),
      traceExporter: new OTLPTraceExporter({
        url: `${process.env.JAEGER_ENDPOINT || 'http://jaeger:14268'}/v1/traces`,
      }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    sdk.start();
    logger.info('OpenTelemetry tracing initialized');
    process.on('SIGTERM', () => sdk.shutdown().catch(console.error));
  } catch (err) {
    logger.warn('Tracing initialization failed (non-fatal)', { error: err.message });
  }
}

/**
 * Bootstrap sequence:
 * 1. Connect master MongoDB
 * 2. Connect Redis
 * 3. Register EventBus listeners
 * 4. Create Express app + HTTP server
 * 5. Attach Socket.io
 * 6. Start listening
 */
async function bootstrap() {
  logger.info(`Starting TenantCore API v${config.app.version} [${config.env}]`);

  // 1. MongoDB
  await connectMaster();
  logger.info('Master database connected');

  // 2. Redis
  const redis = getRedisClient();
  await redis.ping();
  logger.info('Redis connected');

  // 3. EventBus
  EventBus.registerListeners();

  // 4. Express app
  const app = createApp();
  const server = http.createServer(app);

  // 5. Socket.io
  try {
    const { initSocketServer } = require('./src/realtime/SocketServer');
    initSocketServer(server);
    logger.info('WebSocket server initialized');
  } catch (err) {
    logger.warn('Socket.io initialization skipped', { error: err.message });
  }

  // 6. Listen
  await new Promise((resolve, reject) => {
    server.listen(config.app.port, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  logger.info('✅ TenantCore API running', {
    port: config.app.port,
    env: config.env,
    docs: `http://localhost:${config.app.port}/api/docs`,
  });

  return server;
}

async function shutdown(server, signal) {
  logger.info(`${signal} — shutting down gracefully`);
  server.close(async () => {
    try {
      await connectionPool.closeAll();
      await closeMaster();
      await closeAllRedis();
      logger.info('All connections closed');
      process.exit(0);
    } catch (err) {
      logger.error('Shutdown error', { error: err.message });
      process.exit(1);
    }
  });
  setTimeout(() => { logger.error('Forced shutdown'); process.exit(1); }, 30_000);
}

bootstrap().then((server) => {
  process.on('SIGTERM', () => shutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => shutdown(server, 'SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    if (!err.isOperational) shutdown(server, 'uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { error: String(reason) });
  });
}).catch((err) => {
  console.error('Failed to start server:', err.message, err.stack);
  process.exit(1);
});
