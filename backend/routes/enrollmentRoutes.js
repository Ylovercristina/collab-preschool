const router = require('express').Router();
const { protect, allowRoles, requirePermission: P } = require('../middleware/auth');
const { uploadStudentPhoto } = require('../middleware/studentPhotoUpload');
const ctrl = require('../controllers/enrollmentController');

router.use(protect);
router.get('/availability', ctrl.getAvailability);
router.put('/period', allowRoles('admin', 'staff'), P('enrollment', 'manage'), ctrl.updatePeriod);
router.patch('/period/start', allowRoles('admin', 'staff'), P('enrollment', 'manage'), ctrl.startPeriod);
router.get('/applications', allowRoles('admin', 'staff'), P('enrollment', 'view'), ctrl.listApplications);
// Submitting an application for a child is part of limited (view) access.
router.post('/applications', allowRoles('parent', 'teacher'), P('enrollment', 'view'), uploadStudentPhoto('studentPhoto'), ctrl.submitApplication);
router.post('/applications/bulk-approve', allowRoles('admin', 'staff'), P('enrollment', 'approve'), ctrl.bulkApproveApplications);
router.get('/applications/:id/photo', allowRoles('admin', 'staff', 'parent', 'teacher'), P('enrollment', 'view'), ctrl.getApplicationPhoto);
router.patch('/applications/:id', allowRoles('admin', 'staff'), P('enrollment', 'approve'), ctrl.reviewApplication);

module.exports = router;
