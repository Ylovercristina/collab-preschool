const User = require('../models/User');
const logActivity = require('../utils/logActivity');
const backups = require('../services/backupService');

function sendError(res, err, fallback) {
  if (err.status) return res.status(err.status).json({ message: err.message });
  console.error(`[backup] ${fallback}:`, err.message);
  return res.status(500).json({ message: fallback });
}

// Restoring replaces every record, so the administrator confirms with their password and the word RESTORE.
async function confirmRestore(req) {
  if (String(req.body.confirm || '').trim() !== 'RESTORE') {
    return 'Type RESTORE to confirm.';
  }
  const admin = await User.findById(req.user._id).select('+password');
  if (!admin || !admin.password) {
    return 'Your account has no password (Google sign-in). Set a password in your profile before restoring.';
  }
  if (!(await admin.comparePassword(String(req.body.password || '')))) return 'Your password is incorrect.';
  return '';
}

// GET /api/backups
exports.list = async (req, res) => {
  try {
    res.json({
      backups: await backups.listBackups(),
      keep: { auto: backups.AUTO_BACKUPS_TO_KEEP, safety: backups.SAFETY_BACKUPS_TO_KEEP },
    });
  } catch (err) {
    sendError(res, err, 'Could not list backups.');
  }
};

// POST /api/backups
exports.create = async (req, res) => {
  try {
    const meta = await backups.createBackup({ type: 'manual', createdBy: req.user.name });
    await logActivity(req.user._id, 'database-backup-created', `${meta.fileName} (${meta.documents} records)`);
    res.status(201).json({ backup: meta, message: 'Backup created.' });
  } catch (err) {
    sendError(res, err, 'Could not create the backup.');
  }
};

// GET /api/backups/:file/download
exports.download = async (req, res) => {
  try {
    const buffer = await backups.readBackupFile(req.params.file);
    if (!buffer) return res.status(404).json({ message: 'Backup not found.' });
    await logActivity(req.user._id, 'database-backup-downloaded', req.params.file);
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Type', 'application/gzip');
    res.set('Content-Disposition', `attachment; filename="${req.params.file}"`);
    res.send(buffer);
  } catch (err) {
    sendError(res, err, 'Could not download the backup.');
  }
};

// DELETE /api/backups/:file
exports.remove = async (req, res) => {
  try {
    if (!(await backups.deleteBackup(req.params.file))) return res.status(404).json({ message: 'Backup not found.' });
    await logActivity(req.user._id, 'database-backup-deleted', req.params.file);
    res.json({ message: 'Backup deleted.' });
  } catch (err) {
    sendError(res, err, 'Could not delete the backup.');
  }
};

// POST /api/backups/:file/restore  { password, confirm: "RESTORE" }
exports.restoreSaved = async (req, res) => {
  try {
    const problem = await confirmRestore(req);
    if (problem) return res.status(400).json({ message: problem });
    const buffer = await backups.readBackupFile(req.params.file);
    if (!buffer) return res.status(404).json({ message: 'Backup not found.' });
    const result = await backups.restoreBackup(buffer, { restoredBy: req.user.name });
    await logActivity(null, 'database-restored', `${req.params.file} restored by ${req.user.name} (${req.user.email}); safety backup ${result.safetyBackup}`);
    res.json({ ...result, message: 'The database was restored from the backup.' });
  } catch (err) {
    sendError(res, err, 'Could not restore the backup.');
  }
};

// POST /api/backups/upload  (multipart: backup file; optional restore=true with password/confirm)
exports.upload = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Choose a backup file to upload.' });
    const restoreNow = String(req.body.restore) === 'true';
    if (restoreNow) {
      const problem = await confirmRestore(req);
      if (problem) return res.status(400).json({ message: problem });
    }
    const meta = await backups.storeUploadedBackup(req.file.buffer, req.user.name);
    await logActivity(req.user._id, 'database-backup-uploaded', `${req.file.originalname} saved as ${meta.fileName}`);
    if (!restoreNow) return res.status(201).json({ backup: meta, message: 'Backup uploaded. You can restore it from the list.' });
    const result = await backups.restoreBackup(req.file.buffer, { restoredBy: req.user.name });
    await logActivity(null, 'database-restored', `uploaded ${req.file.originalname} restored by ${req.user.name} (${req.user.email}); safety backup ${result.safetyBackup}`);
    res.json({ ...result, backup: meta, message: 'The database was restored from the uploaded backup.' });
  } catch (err) {
    sendError(res, err, 'Could not process the uploaded backup.');
  }
};
