'use strict';

const bcrypt = require('bcryptjs');
const config = require('../../config/app.config');
const { InvalidCredentialsError } = require('../../core/errors');

/**
 * PasswordService — bcrypt hashing and comparison.
 * Rounds are configurable via BCRYPT_ROUNDS env var (default: 12).
 */
class PasswordService {
  constructor() {
    this.rounds = config.bcrypt.rounds;
  }

  /**
   * Hash a plaintext password with bcrypt.
   * Never store raw passwords anywhere — only call this before saving.
   */
  async hash(password) {
    return bcrypt.hash(password, this.rounds);
  }

  /**
   * Compare a plaintext password against a stored hash.
   * Throws InvalidCredentialsError if they don't match (so callers stay DRY).
   */
  async verify(password, hash) {
    const isMatch = await bcrypt.compare(password, hash);
    if (!isMatch) {
      throw new InvalidCredentialsError();
    }
    return true;
  }

  /**
   * Compare without throwing — returns a boolean.
   * Use when you want to handle the mismatch yourself.
   */
  async compare(password, hash) {
    return bcrypt.compare(password, hash);
  }

  /**
   * Validate password strength.
   * Returns array of violation strings (empty = valid).
   */
  validate(password, minLength = 8) {
    const violations = [];
    if (!password || password.length < minLength) {
      violations.push(`Password must be at least ${minLength} characters`);
    }
    if (!/[A-Z]/.test(password)) violations.push('Must contain at least one uppercase letter');
    if (!/[a-z]/.test(password)) violations.push('Must contain at least one lowercase letter');
    if (!/\d/.test(password)) violations.push('Must contain at least one digit');
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      violations.push('Must contain at least one special character');
    }
    return violations;
  }
}

module.exports = new PasswordService();
