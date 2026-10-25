const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const { uploadProgressPhotos } = require('../middleware/progressUpload');
const ctrl = require('../controllers/progressController');

router.use(protect);
router.get('/', allowRoles('admin'), ctrl.listAllProgress);
router.patch('/:id/review', allowRoles('admin'), ctrl.reviewProgress);
router.post('/', allowRoles('teacher'), uploadProgressPhotos, ctrl.addProgress);
router.patch('/:id', allowRoles('teacher'), uploadProgressPhotos, ctrl.updateProgress);
router.get('/:id/attachments/:attachmentId', allowRoles('admin', 'teacher'), ctrl.getAttachment);
router.get('/student/:studentId', ctrl.getStudentProgress);

module.exports = router;
