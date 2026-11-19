const router = require('express').Router();
const { protect, allowRoles, requirePermission: P } = require('../middleware/auth');
const { uploadProgressPhotos } = require('../middleware/progressUpload');
const ctrl = require('../controllers/progressController');
const AcademicProgress = require('../models/AcademicProgress');
const { versionGuard } = require('../middleware/concurrency');

router.use(protect);
router.get('/', allowRoles('admin', 'staff'), P('progress', 'view'), ctrl.listAllProgress);
router.patch('/:id/review', allowRoles('admin', 'staff'), P('progress', 'approve'), ctrl.reviewProgress);
router.get('/google-drive/status', allowRoles('teacher'), P('progress', 'manage'), ctrl.googleDriveStatus);
router.post('/google-drive/connect', allowRoles('teacher'), P('progress', 'manage'), ctrl.connectGoogleDrive);
router.get('/google-drive/picker-config', allowRoles('teacher'), P('progress', 'manage'), ctrl.googleDrivePickerConfig);
router.post('/', allowRoles('teacher'), P('progress', 'manage'), uploadProgressPhotos, ctrl.addProgress);
router.patch('/:id', allowRoles('teacher'), P('progress', 'manage'), versionGuard(AcademicProgress, { label: 'progress record', lock: 'progress' }), uploadProgressPhotos, ctrl.updateProgress);
router.get('/:id/attachments/:attachmentId', allowRoles('admin', 'staff', 'teacher', 'parent'), P('progress', 'view'), ctrl.getAttachment);
router.get('/student/:studentId', P('progress', 'view'), ctrl.getStudentProgress);

module.exports = router;
