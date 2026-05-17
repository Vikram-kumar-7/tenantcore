'use strict';

const express = require('express');
const router = express.Router();
const authController = require('../../../controllers/auth.controller');
const { authenticate } = require('../../../middleware/auth.middleware');
const { loginRateLimit, signupRateLimit } = require('../../../middleware/rateLimit.middleware');

/**
 * Auth Routes — /api/v1/auth
 *
 * Public routes (no auth required):
 *   POST /signup    — Create new account + provision tenant
 *   POST /login     — Authenticate and get tokens
 *   POST /refresh   — Rotate tokens
 *
 * Protected routes:
 *   POST /logout    — Invalidate tokens
 *   GET  /me        — Get current user info
 */

// Public routes
router.post('/signup', signupRateLimit, authController.signupValidation, authController.signup);
router.post('/login', loginRateLimit, authController.loginValidation, authController.login);
router.post('/refresh', authController.refresh);

// Protected routes
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);

module.exports = router;
