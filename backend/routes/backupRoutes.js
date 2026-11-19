const router = require('express').Router();
const multer = require('multer');
const { protect, allowRoles, requireSystemAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/backupController');
const { limits } = require('../middleware/rateLimit');

const MAX_BACKUP_BYTES = 250 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BACKUP_BYTES, files: 1 } });

function uploadBackup(req, res, next) {
  upload.single('backup')(req, res, (err) => {
    if (!err) return next();
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      message: err.code === 'LIMIT_FILE_SIZE' ? 'The backup file is larger than 250 MB.' : err.message,
    });
  });
}

// Backups contain every record, so only a System Administrator may create, download or restore them.
router.use(protect, allowRoles('admin'), requireSystemAdmin, limits.backups);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.post('/upload', uploadBackup, ctrl.upload);
router.get('/:file/download', ctrl.download);
router.post('/:file/restore', ctrl.restoreSaved);
router.delete('/:file', ctrl.remove);

module.exports = router;
