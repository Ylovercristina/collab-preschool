const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const { uploadStudentPhoto } = require('../middleware/studentPhotoUpload');
const ctrl = require('../controllers/enrollmentController');

router.use(protect);
router.get('/availability', ctrl.getAvailability);
router.put('/period', allowRoles('admin'), ctrl.updatePeriod);
router.patch('/period/start', allowRoles('admin'), ctrl.startPeriod);
router.get('/applications', allowRoles('admin'), ctrl.listApplications);
router.post('/applications', allowRoles('parent', 'teacher'), uploadStudentPhoto('studentPhoto'), ctrl.submitApplication);
router.get('/applications/:id/photo', allowRoles('admin', 'parent', 'teacher'), ctrl.getApplicationPhoto);
router.patch('/applications/:id', allowRoles('admin'), ctrl.reviewApplication);

module.exports = router;
