'use strict';

const config = require('./app.config');

/**
 * MinIO client configuration.
 */
const minioConfig = {
  endPoint: config.minio.endpoint,
  port: config.minio.port,
  useSSL: config.minio.useSSL,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
};

/**
 * Return the single bucket name for all tenants.
 */
const buildBucketName = () => config.minio.bucket;

/**
 * Build the object key (path) for a file within a tenant bucket.
 * Format: {category}/{year}/{month}/{filename}
 */
const buildObjectKey = (category, filename) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${category}/${year}/${month}/${filename}`;
};

/**
 * Default signed URL expiry in seconds (15 minutes).
 */
const SIGNED_URL_EXPIRY_SECONDS = 15 * 60;

module.exports = { minioConfig, buildBucketName, buildObjectKey, SIGNED_URL_EXPIRY_SECONDS };
