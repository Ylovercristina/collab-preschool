const Notification = require('../models/Notification');

// GET /api/notifications (parent's own payment notifications)
exports.listMyNotifications = async (req, res) => {
  const notifications = await Notification.find({ parent: req.user._id })
    .populate('student', 'name')
    .populate('fee', 'description amount dueDate')
    .populate('payment', 'receiptNumber receiptState')
    .sort({ createdAt: -1 })
    .limit(50);
  res.json({ notifications });
};

// PATCH /api/notifications/:id/read
exports.markRead = async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, parent: req.user._id },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  if (!notification) return res.status(404).json({ message: 'Notification not found.' });
  res.json({ notification });
};
