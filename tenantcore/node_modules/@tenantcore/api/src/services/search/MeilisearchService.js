'use strict';

const { MeiliSearch } = require('meilisearch');
const config = require('../../config/app.config');
const logger = require('../logger');

/**
 * MeilisearchService — per-tenant full-text search.
 *
 * Tenant isolation: each tenant's data goes into separate named indexes.
 *   Index format: {tenantId}_users, {tenantId}_files, {tenantId}_auditLogs
 *
 * This prevents cross-tenant data leakage at the search layer.
 */
class MeilisearchService {
  constructor() {
    this.client = new MeiliSearch({
      host: config.meilisearch.host,
      apiKey: config.meilisearch.apiKey,
    });
  }

  /**
   * Create all indexes for a new tenant. Called during provisioning.
   */
  async createTenantIndexes(tenantId) {
    const indexes = ['users', 'files', 'auditLogs'];
    for (const indexName of indexes) {
      const uid = this._indexName(tenantId, indexName);
      try {
        await this.client.createIndex(uid, { primaryKey: '_id' });

        // Configure searchable attributes per index
        const index = this.client.index(uid);
        if (indexName === 'users') {
          await index.updateSearchableAttributes(['email', 'firstName', 'lastName', 'role']);
          await index.updateFilterableAttributes(['role', 'status', 'tenantId']);
          await index.updateSortableAttributes(['createdAt', 'lastName']);
        } else if (indexName === 'files') {
          await index.updateSearchableAttributes(['originalName', 'mimeType']);
          await index.updateFilterableAttributes(['mimeType', 'status', 'uploadedBy']);
        }
      } catch (err) {
        if (!err.message?.includes('already exists')) {
          logger.warn('Failed to create Meilisearch index', { uid, error: err.message });
        }
      }
    }
    logger.info('Meilisearch indexes created', { tenantId });
  }

  /**
   * Delete all indexes for a tenant (called on tenant deletion).
   */
  async deleteTenantIndexes(tenantId) {
    const indexes = ['users', 'files', 'auditLogs'];
    for (const indexName of indexes) {
      try {
        await this.client.deleteIndex(this._indexName(tenantId, indexName));
      } catch (err) {
        logger.warn('Failed to delete index', { tenantId, indexName, error: err.message });
      }
    }
  }

  /**
   * Index a user document in Meilisearch.
   */
  async indexUser(tenantId, user) {
    const index = this.client.index(this._indexName(tenantId, 'users'));
    await index.addDocuments([{
      _id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
    }]);
  }

  /**
   * Index a file document.
   */
  async indexFile(tenantId, file) {
    const index = this.client.index(this._indexName(tenantId, 'files'));
    await index.addDocuments([{
      _id: file.fileId,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      status: file.status,
      uploadedBy: file.uploadedBy?.toString(),
      uploadedAt: file.uploadedAt,
    }]);
  }

  /**
   * Remove a document from a specific index.
   */
  async removeDocument(tenantId, indexType, id) {
    const index = this.client.index(this._indexName(tenantId, indexType));
    await index.deleteDocument(id.toString());
  }

  /**
   * Multi-index search query.
   * @param {string} tenantId
   * @param {string} searchTerm
   * @param {{ indexes, filters, limit, offset }} options
   */
  async query(tenantId, searchTerm, options = {}) {
    const { indexes = ['users', 'files'], filters = {}, limit = 20, offset = 0 } = options;

    const queries = indexes.map((indexName) => ({
      indexUid: this._indexName(tenantId, indexName),
      q: searchTerm,
      limit,
      offset,
      filter: Object.entries(filters).map(([k, v]) => `${k} = "${v}"`).join(' AND ') || undefined,
    }));

    try {
      const { results } = await this.client.multiSearch({ queries });
      return results.map((r, i) => ({
        index: indexes[i],
        hits: r.hits,
        total: r.estimatedTotalHits,
        took: r.processingTimeMs,
      }));
    } catch (err) {
      logger.warn('Meilisearch query failed', { tenantId, error: err.message });
      return indexes.map((index) => ({ index, hits: [], total: 0, took: 0 }));
    }
  }

  /**
   * Ping Meilisearch for health checks.
   */
  async ping() {
    const start = Date.now();
    await this.client.health();
    return Date.now() - start;
  }

  _indexName(tenantId, resource) {
    return `${tenantId.toString().replace(/[^a-zA-Z0-9]/g, '_')}_${resource}`;
  }
}

module.exports = new MeilisearchService();
