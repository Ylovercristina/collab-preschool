const Notification = require('../models/Notification');
const mongoose = require('mongoose');

// GET /api/notifications (parent's own notifications)
exports.listMyNotifications = async (req, res) => {
  const notifications = await Notification.find({ parent: req.user._id })
    .populate('event')
    .populate('alert')
    .populate('student', 'name')
    .populate('fee', 'description amount dueDate')
    .populate('payment', 'receiptNumber receiptState')
    .sort({ priority: -1, createdAt: -1 })
    .limit(50);
  const unreadCount = await Notification.countDocuments({ parent: req.user._id, readAt: null });
  res.json({ notifications, unreadCount });
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
