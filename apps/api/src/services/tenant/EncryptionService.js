'use strict';

const crypto = require('crypto');
const config = require('../../config/app.config');

const algorithm = 'aes-256-gcm';

/**
 * Encrypts a string using AES-256-GCM
 * @param {string} text - text to encrypt
 * @returns {object} { encrypted, iv, authTag }
 */
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(config.encryption.key, 'hex');
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * Decrypts a string using AES-256-GCM
 * @param {object} encryptedData - { encrypted, iv, authTag }
 * @returns {string} decrypted text
 */
function decrypt(encryptedData) {
  const { encrypted, iv, authTag } = encryptedData;
  const key = Buffer.from(config.encryption.key, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
