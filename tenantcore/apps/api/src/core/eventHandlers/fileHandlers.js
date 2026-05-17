'use strict';

const logger = require('../../services/logger');

const onFileUploaded = async ({ tenantId, userId, fileId, size }) => {
  logger.info('Event: file.uploaded', { tenantId, userId, fileId, size });
  // Update storage quota, index file in search
};

module.exports = { onFileUploaded };
