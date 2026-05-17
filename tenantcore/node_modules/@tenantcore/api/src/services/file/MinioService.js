'use strict';

const Minio = require('minio');
const { minioConfig, buildBucketName } = require('../../config/minio.config');
const logger = require('../logger');

/**
 * MinioService — wrapper for all MinIO (S3-compatible) operations.
 * Handles bucket management and object operations.
 */
class MinioService {
  constructor() {
    this.client = new Minio.Client(minioConfig);
    this._bucketsEnsured = new Set(); // Cache of verified buckets
  }

  /**
   * Ensure a bucket exists for the given tenant.
   * Creates it if it doesn't exist. Idempotent.
   */
  async ensureBucket(tenantId) {
    const bucket = buildBucketName(tenantId);

    if (this._bucketsEnsured.has(bucket)) return bucket;

    const exists = await this.client.bucketExists(bucket);
    if (!exists) {
      await this.client.makeBucket(bucket, 'us-east-1');
      logger.info('MinIO bucket created', { bucket, tenantId });
    }

    this._bucketsEnsured.add(bucket);
    return bucket;
  }

  /**
   * Delete all objects in a tenant's bucket then remove the bucket.
   * Called when a tenant is permanently deleted.
   */
  async removeBucket(tenantId) {
    const bucket = buildBucketName(tenantId);

    // List and delete all objects first
    await this._emptyBucket(bucket);
    await this.client.removeBucket(bucket);
    this._bucketsEnsured.delete(bucket);
    logger.info('MinIO bucket removed', { bucket, tenantId });
  }

  /**
   * Delete a specific object from storage.
   */
  async deleteObject(bucket, key) {
    await this.client.removeObject(bucket, key);
  }

  /**
   * Get object metadata (size, content type, etc.) without downloading.
   */
  async statObject(bucket, key) {
    return this.client.statObject(bucket, key);
  }

  /**
   * Get object as a stream (for streaming downloads through the API).
   */
  async getObjectStream(bucket, key) {
    return this.client.getObject(bucket, key);
  }

  /**
   * Ping MinIO to check connectivity. Returns latency in ms.
   */
  async ping() {
    const start = Date.now();
    await this.client.listBuckets();
    return Date.now() - start;
  }

  /**
   * Empty all objects in a bucket (used before bucket deletion).
   */
  async _emptyBucket(bucket) {
    return new Promise((resolve, reject) => {
      const objectsList = [];
      const stream = this.client.listObjects(bucket, '', true);

      stream.on('data', (obj) => objectsList.push(obj.name));
      stream.on('error', reject);
      stream.on('end', async () => {
        if (objectsList.length > 0) {
          await this.client.removeObjects(bucket, objectsList);
        }
        resolve();
      });
    });
  }
}

module.exports = new MinioService();
