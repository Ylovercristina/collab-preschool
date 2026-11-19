const Notification = require('../models/Notification');
const mongoose = require('mongoose');

// GET /api/notifications (current user's notifications)
exports.listMyNotifications = async (req, res) => {
  const notifications = await Notification.find({ parent: req.user._id })
    .populate('event')
    .populate('alert')
    .populate('student', 'name')
    .populate({ path: 'academicProgress', populate: [{ path: 'student', select: 'name parent' }, { path: 'teacher', select: 'name' }] })
    .populate('fee', 'description amount dueDate')
    .populate('payment', 'receiptNumber receiptState')
    .sort({ priority: -1, createdAt: -1 })
    .limit(50);
  const visibleNotifications = notifications.filter((notification) => notification.type !== 'academic-progress'
    || (notification.academicProgress && notification.academicProgress.student
      && String(notification.academicProgress.student.parent) === String(req.user._id)));
  // Don't count unread notifications this person can't see (e.g. progress notes about a child no
  // longer linked to them), so the badge never shows a number when everything visible is read.
  const hiddenUnread = notifications.filter((notification) => !notification.readAt && !visibleNotifications.includes(notification)).length;
  const totalUnread = await Notification.countDocuments({ parent: req.user._id, readAt: null });
  const unreadCount = Math.max(0, totalUnread - hiddenUnread);
  res.json({ notifications: visibleNotifications, unreadCount });
};

// PATCH /api/notifications/read-all (marks every unread notification as read, including older ones)
exports.markAllRead = async (req, res) => {
  const result = await Notification.updateMany(
    { parent: req.user._id, readAt: null },
    { $set: { readAt: new Date() } }
  );
  res.json({ updated: result.modifiedCount, unreadCount: 0 });
};

// PATCH /api/notifications/:id/read
exports.markRead = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ message: 'Notification not found.' });
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, parent: req.user._id },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  if (!notification) return res.status(404).json({ message: 'Notification not found.' });
  res.json({ notification });
};
