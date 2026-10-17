const EmergencyAlert = require('../models/EmergencyAlert');
const EmailLog = require('../models/EmailLog');
const Notification = require('../models/Notification');
const Student = require('../models/Student');
const User = require('../models/User');
const { queueEmailDelivery } = require('../services/emailDelivery');
const logActivity = require('../utils/logActivity');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function parentsForAlert(alert) {
  const parentIds = await Student.distinct('parent', { _id: { $in: alert.students }, parent: { $ne: null } });
  return User.find({ _id: { $in: parentIds }, role: 'parent' })
    .select('name email role status emailVerified emailVerifiedBy');
}

function alertEmail(alert, update) {
  const title = update ? (update.status === 'all-clear' ? 'All-clear notice' : 'Emergency update') : alert.title;
  const content = update ? update.message : [
    `${alert.emergencyType} · Severity: ${alert.severity}`,
    alert.description || alert.message,
    `Safety instructions: ${alert.safetyInstructions}`,
  ].join('\n\n');
  const url = `${process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500'}/frontend/pages/dashboard-parent.html`;
  const subject = `URGENT: ${title}`;
  return {
    subject,
    text: `${title}\n\n${content}\n\nOpen the Parent dashboard: ${url}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#7f1d1d"><h2>URGENT: ${escapeHtml(title)}</h2><p>${escapeHtml(content).replace(/\r?\n/g, '<br>')}</p><p><a href="${escapeHtml(url)}">Open the Parent dashboard</a></p></div>`,
  };
}

async function notifyParents(alert, update) {
  const parents = await parentsForAlert(alert);
  const title = update
    ? `${update.status === 'all-clear' ? 'All-clear' : 'Emergency update'}: ${alert.title}`
    : `URGENT: ${alert.title}`;
  const message = update ? update.message : [alert.description || alert.message, alert.safetyInstructions].filter(Boolean).join('\n\n');
  if (parents.length) {
    await Notification.bulkWrite(parents.map((parent) => ({
      updateOne: {
        filter: { parent: parent._id, alert: alert._id, alertUpdate: update?._id || null, type: 'emergency' },
        update: { $setOnInsert: { parent: parent._id, alert: alert._id, alertUpdate: update?._id || null, type: 'emergency', priority: 2, title, message } },
        upsert: true,
      },
    })));
    queueEmailDelivery({ ...alertEmail(alert, update), parents, type: 'emergency', alertId: alert._id });
  }
  alert.emailRecipientCount = (alert.emailRecipientCount || 0) + parents.length;
  await alert.save();
  return parents;
}

async function emailSummary(alert) {
  const logs = await EmailLog.find({ alert: alert._id }).select('status errorMessage');
  const summary = {
    sent: logs.filter((log) => log.status === 'sent').length,
    skipped: logs.filter((log) => log.status === 'skipped').length,
    unverified: logs.filter((log) => log.status === 'skipped' && log.errorMessage.includes('not verified')).length,
    failed: logs.filter((log) => log.status === 'failed').length,
    expected: alert.emailRecipientCount || 0,
  };
  summary.complete = logs.length >= summary.expected;
  return summary;
}

async function scopedAlert(alertId, user, { includeInactive = false } = {}) {
  const alert = await EmergencyAlert.findById(alertId);
  if (!alert) return null;
  if (!includeInactive && ['archived', 'deleted'].includes(alert.status)) return null;
  if (user.role === 'admin') return alert;
  if (user.role === 'teacher') {
    const count = await Student.countDocuments({ _id: { $in: alert.students }, teacher: user._id });
    if (String(alert.createdBy) === String(user._id) || count === alert.students.length) return alert;
    return null;
  }
  const linked = await Student.exists({ parent: user._id, _id: { $in: alert.students } });
  return linked ? alert : null;
}

// POST /api/alerts
exports.createAlert = async (req, res) => {
  try {
    const emergencyType = String(req.body.emergencyType || '').trim();
    const severity = String(req.body.severity || 'high').trim();
    const description = String(req.body.description || req.body.message || '').trim();
    const safetyInstructions = String(req.body.safetyInstructions || '').trim();
    const title = String(req.body.title || emergencyType).trim();
    const requestedStudents = Array.isArray(req.body.students) ? req.body.students.map(String) : [];
    const requestedClasses = Array.isArray(req.body.affectedClasses)
      ? [...new Set(req.body.affectedClasses.map((item) => String(item).trim()).filter(Boolean))]
      : [];

    if (!emergencyType || !title || !description || !safetyInstructions) {
      return res.status(400).json({ message: 'Emergency type, description and safety instructions are required.' });
    }
    if (!['low', 'moderate', 'high', 'critical'].includes(severity)) {
      return res.status(400).json({ message: 'Select a valid severity.' });
    }
    if (!requestedStudents.length && !requestedClasses.length) {
      return res.status(400).json({ message: 'Select at least one pupil or class.' });
    }

    const studentFilter = { status: 'active' };
    if (req.user.role === 'teacher') studentFilter.teacher = req.user._id;
    const scope = [];
    if (requestedStudents.length) scope.push({ _id: { $in: requestedStudents } });
    if (requestedClasses.length) scope.push({ className: { $in: requestedClasses } });
    const students = await Student.find({ ...studentFilter, $or: scope }).select('_id className parent');
    const matchedRequestedStudents = students.filter((student) => requestedStudents.includes(String(student._id))).length;
    if (matchedRequestedStudents !== new Set(requestedStudents).size) {
      return res.status(403).json({ message: 'One or more selected pupils are not in your assigned roster.' });
    }
    if (!students.length) return res.status(400).json({ message: 'No active pupils match this alert audience.' });

    const alert = await EmergencyAlert.create({
      title,
      message: description,
      emergencyType,
      severity,
      description,
      safetyInstructions,
      affectedClasses: requestedClasses,
      students: students.map((student) => student._id),
      createdBy: req.user._id,
    });
    const parents = await notifyParents(alert);
    await logActivity(req.user._id, 'emergency-alert', title);
    const unverifiedContacts = parents
      .filter((parent) => parent.status !== 'approved' || !parent.emailVerified || !parent.emailVerifiedBy)
      .map((parent) => ({ name: parent.name, email: parent.email || '' }));
    return res.status(201).json({
      alert,
      recipientCount: parents.length,
      unverifiedContacts,
      emailSummary: await emailSummary(alert),
    });
  } catch (err) {
    const status = err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500;
    console.error('[alerts] Could not create alert:', err.message);
    return res.status(status).json({ message: status === 400 ? err.message : 'Could not create emergency alert.' });
  }
};

// GET /api/alerts
exports.listAlerts = async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'parent') {
      const children = await Student.find({ parent: req.user._id }).select('_id');
      filter.students = { $in: children.map((student) => student._id) };
      filter.status = { $nin: ['archived', 'deleted'] };
    } else if (req.user.role === 'teacher') {
      const students = await Student.find({ teacher: req.user._id }).select('_id');
      filter.$or = [{ createdBy: req.user._id }, { students: { $in: students.map((student) => student._id) } }];
      filter.status = req.query.view === 'archived'
        ? { $in: ['archived', 'deleted'] }
        : { $nin: ['archived', 'deleted'] };
    } else {
      filter.status = req.query.view === 'archived'
        ? { $in: ['archived', 'deleted'] }
        : { $nin: ['archived', 'deleted'] };
    }
    const alerts = await EmergencyAlert.find(filter).populate('createdBy', 'name role').sort({ createdAt: -1 }).limit(50);
    res.json({ alerts });
  } catch (err) {
    res.status(500).json({ message: 'Could not load emergency alerts.' });
  }
};

// PATCH /api/alerts/:id/archive
exports.archiveAlert = async (req, res) => {
  try {
    const alert = await scopedAlert(req.params.id, req.user, { includeInactive: true });
    if (!alert) return res.status(404).json({ message: 'Alert not found.' });
    if (['archived', 'deleted'].includes(alert.status)) {
      return res.status(409).json({ message: 'This alert is already archived or deleted.' });
    }
    alert.archivedFromStatus = ['active', 'update', 'all-clear'].includes(alert.status) ? alert.status : 'active';
    alert.status = 'archived';
    alert.archivedAt = new Date();
    alert.archivedBy = req.user._id;
    await alert.save();
    await logActivity(req.user._id, 'emergency-alert-archived', alert.title);
    return res.json({ alert, message: 'Alert archived.' });
  } catch (err) {
    console.error('[alerts] Could not archive alert:', err.message);
    return res.status(500).json({ message: 'Could not archive this alert.' });
  }
};

// PATCH /api/alerts/:id/restore
exports.restoreAlert = async (req, res) => {
  try {
    const alert = await scopedAlert(req.params.id, req.user, { includeInactive: true });
    if (!alert) return res.status(404).json({ message: 'Alert not found.' });
    if (alert.status !== 'archived') return res.status(409).json({ message: 'Only archived alerts can be restored.' });
    alert.status = ['active', 'update', 'all-clear'].includes(alert.archivedFromStatus) ? alert.archivedFromStatus : 'active';
    alert.archivedAt = null;
    alert.archivedBy = null;
    await alert.save();
    await logActivity(req.user._id, 'emergency-alert-restored', alert.title);
    return res.json({ alert, message: 'Alert restored.' });
  } catch (err) {
    console.error('[alerts] Could not restore alert:', err.message);
    return res.status(500).json({ message: 'Could not restore this alert.' });
  }
};

// DELETE /api/alerts/:id (soft delete; records and delivery history are retained)
exports.deleteArchivedAlert = async (req, res) => {
  try {
    const alert = await scopedAlert(req.params.id, req.user, { includeInactive: true });
    if (!alert) return res.status(404).json({ message: 'Alert not found.' });
    if (alert.status === 'deleted') return res.status(409).json({ message: 'This alert is already deleted.' });
    alert.status = 'deleted';
    alert.deletedAt = new Date();
    alert.deletedBy = req.user._id;
    await alert.save();
    await logActivity(req.user._id, 'emergency-alert-deleted', alert.title);
    return res.json({ alert, message: 'Alert moved to deleted status. Acknowledgments and email logs were retained.' });
  } catch (err) {
    console.error('[alerts] Could not delete archived alert:', err.message);
    return res.status(500).json({ message: 'Could not delete this alert.' });
  }
};

// POST /api/alerts/:id/updates
exports.addUpdate = async (req, res) => {
  try {
    const alert = await scopedAlert(req.params.id, req.user);
    if (!alert || req.user.role === 'parent') return res.status(404).json({ message: 'Alert not found.' });
    const message = String(req.body.message || '').trim();
    const status = req.body.status === 'all-clear' ? 'all-clear' : 'update';
    if (!message) return res.status(400).json({ message: 'Enter an update message.' });
    if (status === 'all-clear' && req.user.role !== 'admin' && String(alert.createdBy) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the issuing teacher or an admin may issue an all-clear.' });
    }
    alert.status = status;
    alert.updates.push({ message, status, createdBy: req.user._id });
    await alert.save();
    const parents = await notifyParents(alert, alert.updates[alert.updates.length - 1]);
    res.json({ alert, recipientCount: parents.length, emailSummary: await emailSummary(alert) });
  } catch (err) {
    console.error('[alerts] Could not publish update:', err.message);
    res.status(500).json({ message: 'Could not publish emergency update.' });
  }
};

// PATCH /api/alerts/:id/acknowledge
exports.acknowledge = async (req, res) => {
  const alert = await scopedAlert(req.params.id, req.user);
  if (!alert || req.user.role !== 'parent') return res.status(404).json({ message: 'Alert not found.' });
  if (!alert.acknowledgements.some((item) => String(item.parent) === String(req.user._id))) {
    alert.acknowledgements.push({ parent: req.user._id, acknowledgedAt: new Date() });
    await alert.save();
  }
  res.json({ alertId: alert._id, acknowledgedAt: alert.acknowledgements.find((item) => String(item.parent) === String(req.user._id)).acknowledgedAt });
};

// GET /api/alerts/:id/email-summary
exports.getEmailSummary = async (req, res) => {
  const alert = await scopedAlert(req.params.id, req.user);
  if (!alert || req.user.role === 'parent') return res.status(404).json({ message: 'Alert not found.' });
  res.json({ emailSummary: await emailSummary(alert) });
};
