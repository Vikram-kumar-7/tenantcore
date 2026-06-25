'use strict';

const EventEmitter = require('events');
const logger = require('../services/logger');

/**
 * EventBus — Internal async event bus for decoupled service communication.
 *
 * Extends Node.js EventEmitter with:
 * - Async handler support (handlers can be async functions)
 * - Failed handler retry (up to 3 attempts with exponential backoff)
 * - Event persistence logging for debugging
 *
 * Usage:
 *   EventBus.emit('user.created', { tenantId, userId, email })
 *   EventBus.on('user.created', async (payload) => { ... })
 */

class AsyncEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // Allow many listeners across services
    this._handlerMap = new Map(); // name → wrapped handler (for removal)
  }

  /**
   * Register an async event handler.
   * Wraps it with retry logic and error isolation.
   */
  on(event, handler, options = {}) {
    const { maxRetries = 3, retryDelay = 1000, label = handler.name || 'anonymous' } = options;

    const wrapped = async (payload) => {
      let attempt = 0;
      while (attempt <= maxRetries) {
        try {
          await handler(payload);
          return;
        } catch (err) {
          attempt++;
          logger.warn(`EventBus handler failed (attempt ${attempt}/${maxRetries + 1})`, {
            event,
            handler: label,
            error: err.message,
          });

          if (attempt > maxRetries) {
            logger.error('EventBus handler exhausted retries', { event, handler: label, error: err.message });
            return;
          }

          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, retryDelay * 2 ** (attempt - 1)));
        }
      }
    };

    // Store wrapped handler so it can be removed with off()
    const key = `${event}:${label}`;
    this._handlerMap.set(key, wrapped);

    super.on(event, wrapped);
    return this;
  }

  /**
   * Emit an event. All registered handlers receive the payload asynchronously.
   * The emit call returns immediately — listeners run in the background.
   */
  emit(event, payload = {}) {
    const enriched = {
      ...payload,
      _event: event,
      _timestamp: new Date().toISOString(),
    };

    logger.debug('EventBus emit', { event, payload: Object.keys(enriched) });

    // Schedule handlers asynchronously so emit() never blocks
    setImmediate(() => {
      super.emit(event, enriched);
    });

    return true;
  }

  /**
   * Emit synchronously (for tests or forced sequential execution).
   */
  emitSync(event, payload = {}) {
    return super.emit(event, { ...payload, _event: event, _timestamp: new Date().toISOString() });
  }
}

// Singleton EventBus exported for use across the entire application
const EventBus = new AsyncEventBus();

// Register event listeners from all services
// This is called once at startup from app.js
EventBus.registerListeners = () => {
  // Tenant lifecycle
  EventBus.on('tenant.created', require('./eventHandlers/tenantHandlers').onTenantCreated);
  EventBus.on('tenant.suspended', require('./eventHandlers/tenantHandlers').onTenantSuspended);

  // User lifecycle
  EventBus.on('user.created', require('./eventHandlers/userHandlers').onUserCreated);
  EventBus.on('user.role_changed', require('./eventHandlers/userHandlers').onUserRoleChanged);
  EventBus.on('user.login', require('./eventHandlers/userHandlers').onUserLogin);

  // Quota events
  EventBus.on('quota.warning', require('./eventHandlers/quotaHandlers').onQuotaWarning);
  EventBus.on('quota.exceeded', require('./eventHandlers/quotaHandlers').onQuotaExceeded);

  // File events
  EventBus.on('file.uploaded', require('./eventHandlers/fileHandlers').onFileUploaded);

  logger.info('EventBus listeners registered');
};

module.exports = EventBus;
