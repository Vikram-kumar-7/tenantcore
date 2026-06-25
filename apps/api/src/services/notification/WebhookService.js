'use strict';

const crypto = require('crypto');
const config = require('../../config/app.config');

/**
 * Signs a webhook payload using HMAC SHA-256
 * @param {object} payload - payload to sign
 * @returns {string} HMAC signature
 */
function signPayload(payload) {
  return crypto
    .createHmac('sha256', config.webhook.secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

/**
 * Verifies a webhook signature
 * @param {object} payload - payload to verify
 * @param {string} signature - signature to verify against
 * @returns {boolean} true if valid
 */
function verifySignature(payload, signature) {
  const expected = signPayload(payload);
  return expected === signature;
}

module.exports = { signPayload, verifySignature };
