'use strict';

const express = require('express');
const router = express.Router();

// GET /notifications
router.get('/', async (req, res, next) => {
  try {
    const { db, tenant, user } = req.context;
    const { page = 1, limit = 20, unreadOnly } = req.query;
    const filter = { tenantId: tenant.id, userId: user.id };
    if (unreadOnly === 'true') filter.isRead = false;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [notifications, total] = await Promise.all([
      db.Notification.find(filter).lean().sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      db.Notification.countDocuments(filter),
    ]);
    const unreadCount = await db.Notification.countDocuments({ tenantId: tenant.id, userId: user.id, isRead: false });
    res.json({ success: true, data: { notifications, unreadCount }, pagination: { page: +page, limit: +limit, total } });
  } catch (err) { next(err); }
});

// PATCH /notifications/:id/read
router.patch('/:id/read', async (req, res, next) => {
  try {
    const { db, tenant, user } = req.context;
    await db.Notification.updateOne(
      { _id: req.params.id, tenantId: tenant.id, userId: user.id },
      { $set: { isRead: true, readAt: new Date() } }
    );
    res.json({ success: true, data: { message: 'Marked as read' } });
  } catch (err) { next(err); }
});

// PATCH /notifications/read-all
router.patch('/read-all', async (req, res, next) => {
  try {
    const { db, tenant, user } = req.context;
    await db.Notification.updateMany(
      { tenantId: tenant.id, userId: user.id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
    res.json({ success: true, data: { message: 'All notifications marked as read' } });
  } catch (err) { next(err); }
});

module.exports = router;
