const ActivityLog = require('../models/ActivityLog');

async function logActivity(userId, action, details = '') {
  try {
    await ActivityLog.create({ user: userId, action, details });
  } catch (err) {
    console.error('[activity-log] failed to record:', err.message);
  }
}

module.exports = logActivity;
