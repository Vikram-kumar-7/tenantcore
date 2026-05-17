'use strict';

const mongoose = require('mongoose');
const config = require('../config/app.config');
const logger = require('../services/logger');

let masterConnection = null;

/**
 * Connect to the master database.
 * The master DB holds cross-tenant data: Tenant records, ApiKeys, TenantConfig.
 * This connection is a singleton — called once at server startup.
 */
async function connectMaster() {
  if (masterConnection && masterConnection.readyState === 1) {
    return masterConnection;
  }

  const opts = {
    maxPoolSize: config.mongodb.maxPoolSize,
    minPoolSize: config.mongodb.minPoolSize,
    socketTimeoutMS: 30_000,
    serverSelectionTimeoutMS: 10_000,
    heartbeatFrequencyMS: 10_000,
  };

  try {
    const conn = await mongoose.createConnection(config.mongodb.masterUri, opts);

    conn.on('connected', () => logger.info('Master DB connected', { service: 'db' }));
    conn.on('disconnected', () => logger.warn('Master DB disconnected', { service: 'db' }));
    conn.on('error', (err) => logger.error('Master DB error', { error: err.message, service: 'db' }));

    masterConnection = conn;
    logger.info('Master DB connection established', { uri: config.mongodb.masterUri, service: 'db' });
    return conn;
  } catch (err) {
    logger.error('Failed to connect to master DB', { error: err.message, service: 'db' });
    throw err;
  }
}

/**
 * Return the active master connection (throws if not yet connected).
 */
function getMasterConnection() {
  if (!masterConnection || masterConnection.readyState !== 1) {
    throw new Error('Master DB is not connected. Call connectMaster() first.');
  }
  return masterConnection;
}

/**
 * Ping master DB — returns latency in ms. Used by health checks.
 */
async function pingMaster() {
  const start = Date.now();
  await getMasterConnection().db.admin().ping();
  return Date.now() - start;
}

/**
 * Gracefully close master connection.
 */
async function closeMaster() {
  if (masterConnection) {
    await masterConnection.close();
    masterConnection = null;
    logger.info('Master DB connection closed', { service: 'db' });
  }
}

module.exports = { connectMaster, getMasterConnection, pingMaster, closeMaster };
