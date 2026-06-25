'use strict';

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../middleware/rbac.middleware');
const { body, validationResult } = require('express-validator');
const { ValidationError, NotFoundError } = require('../../../core/errors');
const { v4: uuidv4 } = require('uuid');
const { buildBucketName, buildObjectKey } = require('../../../config/minio.config');
const EventBus = require('../../../core/EventBus');

/**
 * File Routes — /api/v1/files
 *
 * Upload flow:
 *   1. POST /upload-url      → get pre-signed PUT URL from MinIO
 *   2. PUT {uploadUrl}       → client uploads directly to MinIO
 *   3. POST /:id/confirm     → server marks file as uploaded
 */

// GET /files — List files
router.get('/', requirePermission('files:upload'), async (req, res, next) => {
  try {
    const { db, tenant } = req.context;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [files, total] = await Promise.all([
      db.File.find({ tenantId: tenant.id }).lean()
        .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      db.File.countDocuments({ tenantId: tenant.id }),
    ]);

    res.json({
      success: true,
      data: { files },
      pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

// POST /files/upload-url — Request a pre-signed upload URL
router.post('/upload-url',
  requirePermission('files:upload'),
  [
    body('filename').notEmpty().trim(),
    body('mimeType').notEmpty(),
    body('size').isInt({ min: 1 }),
    body('category').optional().trim().default('general'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new ValidationError('Validation failed', errors.array());

      const { db, tenant, user } = req.context;
      const { filename, mimeType, size, category = 'general', metadata = {} } = req.body;

      // Lazy-load MinIO service
      const MinioService = require('../../../services/file/MinioService');
      const SignedUrlService = require('../../../services/file/SignedUrlService');

      const fileId = uuidv4();
      const ext = filename.split('.').pop()?.toLowerCase();
      const storedName = `${fileId}.${ext}`;
      const bucket = buildBucketName(tenant.id.toString());
      const key = buildObjectKey(category, storedName);

      // Create pending file record
      await db.File.create({
        tenantId: tenant.id,
        uploadedBy: user.id,
        fileId,
        originalName: filename,
        storedName,
        mimeType,
        size,
        extension: ext,
        bucket,
        key,
        status: 'pending',
        metadata,
      });

      // Generate pre-signed PUT URL (client uploads directly)
      const uploadUrl = await SignedUrlService.presignedPut(bucket, key, 15 * 60); // 15 min

      res.status(201).json({
        success: true,
        data: { fileId, uploadUrl, expiresIn: 900 },
      });
    } catch (err) { next(err); }
  }
);

// POST /files/:id/confirm — Client calls after successful direct upload
router.post('/:id/confirm', requirePermission('files:upload'), async (req, res, next) => {
  try {
    const { db, tenant, user } = req.context;
    const file = await db.File.findOne({ fileId: req.params.id, tenantId: tenant.id });
    if (!file) throw new NotFoundError('File');
    if (file.status !== 'pending') throw new ValidationError('File is not in pending state');

    file.status = 'uploaded';
    file.uploadedAt = new Date();
    await file.save();

    req.setAuditResource?.({ type: 'file', id: file._id, name: file.originalName });
    EventBus.emit('file.uploaded', {
      tenantId: tenant.id, userId: user.id, fileId: file.fileId, size: file.size,
    });

    res.json({ success: true, data: { file } });
  } catch (err) { next(err); }
});

// GET /files/:id/download — Get a pre-signed download URL
router.get('/:id/download', requirePermission('files:upload'), async (req, res, next) => {
  try {
    const { db, tenant } = req.context;
    const file = await db.File.findOne({ fileId: req.params.id, tenantId: tenant.id }).lean();
    if (!file) throw new NotFoundError('File');
    if (file.status !== 'uploaded') throw new ValidationError('File not yet uploaded');

    const SignedUrlService = require('../../../services/file/SignedUrlService');
    const downloadUrl = await SignedUrlService.presignedGet(file.bucket, file.key, 15 * 60);

    res.json({ success: true, data: { downloadUrl, expiresIn: 900 } });
  } catch (err) { next(err); }
});

// DELETE /files/:id — Soft delete
router.delete('/:id', requirePermission('files:upload'), async (req, res, next) => {
  try {
    const { db, tenant, user } = req.context;
    const file = await db.File.findOne({ fileId: req.params.id, tenantId: tenant.id });
    if (!file) throw new NotFoundError('File');

    file.deletedAt = new Date();
    file.deletedBy = user.id;
    file.status = 'deleted';
    await file.save();

    req.setAuditResource?.({ type: 'file', id: file._id, name: file.originalName });
    EventBus.emit('file.deleted', { tenantId: tenant.id, userId: user.id, fileId: file.fileId });

    res.json({ success: true, data: { message: 'File deleted' } });
  } catch (err) { next(err); }
});

// POST /files/:id/restore
router.post('/:id/restore', requirePermission('files:upload'), async (req, res, next) => {
  try {
    const { db, tenant } = req.context;
    const file = await db.File.findWithDeleted({ fileId: req.params.id, tenantId: tenant.id }).findOne();
    if (!file) throw new NotFoundError('File');

    file.deletedAt = null;
    file.deletedBy = null;
    file.status = 'uploaded';
    await file.save();

    res.json({ success: true, data: { message: 'File restored' } });
  } catch (err) { next(err); }
});

module.exports = router;
