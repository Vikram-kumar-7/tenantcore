'use strict';

const Redis = require('ioredis');
const { redisConfig } = require('../config/redis.config');
const logger = require('./logger');

/**
 * Singleton Redis client factory.
 * Supports graceful degradation — if Redis is unavailable, operations
 * fail with a warning instead of crashing the server.
 * Redis uses lazyConnect so it does not throw on startup if Redis is down.
 */

let defaultClient = null;
const namedClients = new Map();

function createClient(options = {}, name = 'default') {
  const client = new Redis({
    ...redisConfig,
    ...options,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null; // Stop retrying after 5 attempts
      return Math.min(times * 500, 3000);
    },
  });

  client.on('connect', () => logger.info(`Redis [${name}] connecting`));
  client.on('ready', () => logger.info(`Redis [${name}] ready`));
  client.on('error', (err) => logger.error(`Redis [${name}] error`, { error: err.message }));
  client.on('close', () => logger.warn(`Redis [${name}] connection closed`));
  client.on('reconnecting', () => logger.info(`Redis [${name}] reconnecting...`));

  // Attempt connection (non-blocking — won't throw if Redis is down)
  client.connect().catch((err) => {
    logger.warn(`Redis [${name}] initial connection failed — will retry`, { error: err.message });
  });

  return client;
}

function getRedisClient() {
  if (!defaultClient) {
    defaultClient = createClient({}, 'main');
  }
  return defaultClient;
}

function getNamedClient(name, options = {}) {
  if (!namedClients.has(name)) {
    namedClients.set(name, createClient(options, name));
  }
  return namedClients.get(name);
}

async function pingRedis() {
  const start = Date.now();
  await getRedisClient().ping();
  return Date.now() - start;
}

async function closeAllRedis() {
  const promises = [];
  if (defaultClient) promises.push(defaultClient.quit().catch(() => {}));
  for (const [, client] of namedClients) promises.push(client.quit().catch(() => {}));
  await Promise.allSettled(promises);
  defaultClient = null;
  namedClients.clear();
  logger.info('All Redis connections closed');
}

module.exports = { getRedisClient, getNamedClient, createClient, pingRedis, closeAllRedis };
