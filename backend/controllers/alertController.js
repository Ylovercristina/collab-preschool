const EmergencyAlert = require('../models/EmergencyAlert');
const logActivity = require('../utils/logActivity');

// POST /api/alerts   (teacher or admin)
exports.createAlert = async (req, res) => {
  try {
    const { title, message, students } = req.body;
    const alert = await EmergencyAlert.create({ title, message, students, createdBy: req.user._id });
    await logActivity(req.user._id, 'emergency-alert', title);
    res.status(201).json({ alert });
  } catch (err) {
    res.status(500).json({ message: 'Could not send alert.', error: err.message });
  }
};

// GET /api/alerts
exports.listAlerts = async (req, res) => {
  const alerts = await EmergencyAlert.find().populate('createdBy', 'name role').sort({ createdAt: -1 }).limit(50);
  res.json({ alerts });
};
