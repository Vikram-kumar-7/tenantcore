'use strict';

const logger = require('../../services/logger');

const onQuotaWarning = async ({ tenantId, metric, percentage }) => {
  logger.warn('Event: quota.warning', { tenantId, metric, percentage });
  // Send in-app notification + warning email
};

const onQuotaExceeded = async ({ tenantId, metric }) => {
  logger.error('Event: quota.exceeded', { tenantId, metric });
  // Block further usage, send urgent notification
};

module.exports = { onQuotaWarning, onQuotaExceeded };
