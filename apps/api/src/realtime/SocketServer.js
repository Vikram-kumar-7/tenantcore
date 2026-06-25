'use strict';

const { Server } = require('socket.io');
const jwtService = require('../services/auth/JwtService');
const logger = require('../services/logger');

// Import gauge directly from the module that creates it (no circular dependency)
let activeWebsocketConnections = null;
try {
  activeWebsocketConnections = require('../app').activeWebsocketConnections;
} catch {
  // App module may not be loaded yet in test environments
}


/**
 * SocketServer — Socket.io server with per-tenant rooms and JWT authentication.
 *
 * Room structure:
 *   tenant:{tenantId}     → All users in this tenant
 *   user:{userId}         → Individual user notifications
 *   admin:{tenantId}      → Admin-only events (live analytics)
 */

let io = null;

/**
 * Initialize Socket.io on an existing HTTP server.
 */
function initSocketServer(httpServer) {
  const config = require('../config/app.config');

  io = new Server(httpServer, {
    cors: {
      origin: config.cors.origins,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── Authentication middleware ────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) return next(new Error('Authentication required'));

      const payload = jwtService.verifyAccessToken(token);
      socket.user = {
        id: payload.sub,
        tenantId: payload.tenantId,
        role: payload.role,
        email: payload.email,
        permissions: payload.permissions,
      };

      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection handler ───────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { user } = socket;
    logger.debug('WebSocket connected', { userId: user.id, tenantId: user.tenantId });

    // Track active connections in Prometheus
    activeWebsocketConnections?.inc();

    // Join tenant and user rooms
    socket.join(`tenant:${user.tenantId}`);
    socket.join(`user:${user.id}`);

    // Admins and owners join the admin room for live analytics
    if (['owner', 'admin'].includes(user.role)) {
      socket.join(`admin:${user.tenantId}`);
    }

    // Announce presence to tenant room
    socket.to(`tenant:${user.tenantId}`).emit('presence:joined', {
      userId: user.id,
      timestamp: new Date().toISOString(),
    });

    // ── Client-initiated events ────────────────────────────────────────────────

    socket.on('presence:ping', () => {
      socket.emit('presence:pong', { timestamp: new Date().toISOString() });
    });

    // ── Disconnect ─────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      activeWebsocketConnections?.dec();
      socket.to(`tenant:${user.tenantId}`).emit('presence:left', {
        userId: user.id,
        timestamp: new Date().toISOString(),
      });
      logger.debug('WebSocket disconnected', { userId: user.id, reason });
    });
  });

  // Start live analytics push (every 5 seconds to admin rooms)
  setInterval(() => {
    pushLiveAnalytics();
  }, 5000);

  logger.info('Socket.io server initialized');
  return io;
}

/**
 * Push live analytics to all admin rooms.
 */
async function pushLiveAnalytics() {
  if (!io) return;
  const sockets = await io.fetchSockets();
  const activeUsers = sockets.length;

  // Push to all admin rooms
  io.to(/^admin:/).emit?.('analytics:update', {
    activeUsers,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get the Socket.io instance (for use in controllers/services).
 */
function getIO() {
  return io;
}

/**
 * Emit a notification to a specific user.
 */
function emitToUser(userId, event, data) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

/**
 * Emit an event to all users in a tenant.
 */
function emitToTenant(tenantId, event, data) {
  if (!io) return;
  io.to(`tenant:${tenantId}`).emit(event, data);
}

module.exports = { initSocketServer, getIO, emitToUser, emitToTenant };
