'use strict';

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../../config/app.config');

/**
 * SignedUrlService — generates pre-signed URLs for direct client ↔ MinIO transfers using AWS S3 SDK.
 */
class SignedUrlService {
  constructor() {
    const protocol = config.minio.useSSL ? 'https' : 'http';
    this.s3 = new S3Client({
      region: 'us-east-1',
      endpoint: `${protocol}://${config.minio.endpoint}:${config.minio.port}`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.minio.accessKey,
        secretAccessKey: config.minio.secretKey,
      },
    });
  }

  async presignedPut(bucket, key, expiry = 900) {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    return getSignedUrl(this.s3, command, { expiresIn: expiry });
  }

  async presignedGet(bucket, key, expiry = 900) {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    return getSignedUrl(this.s3, command, { expiresIn: expiry });
  }

  async presignedGetWithHeaders(bucket, key, expiry = 900, headers = {}) {
    const params = { Bucket: bucket, Key: key };
    if (headers['response-content-disposition']) {
      params.ResponseContentDisposition = headers['response-content-disposition'];
    }
    const command = new GetObjectCommand(params);
    return getSignedUrl(this.s3, command, { expiresIn: expiry });
  }
}

module.exports = new SignedUrlService();
