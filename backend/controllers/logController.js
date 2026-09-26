const ActivityLog = require('../models/ActivityLog');

// GET /api/logs   (admin only)
exports.listLogs = async (req, res) => {
  const logs = await ActivityLog.find().populate('user', 'name role email').sort({ createdAt: -1 }).limit(200);
  res.json({ logs });
};
