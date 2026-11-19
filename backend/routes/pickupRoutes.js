const router = require('express').Router();
const { protect, allowRoles, requirePermission: P } = require('../middleware/auth');
const ctrl = require('../controllers/pickupController');
const PickupAuthorization = require('../models/PickupAuthorization');
const { versionGuard } = require('../middleware/concurrency');

router.use(protect);
router.post('/', allowRoles('admin', 'staff', 'teacher', 'parent'), P('pickup', 'manage'), ctrl.addAuthorization);
router.get('/student/:studentId', P('pickup', 'view'), ctrl.getStudentAuthorizations);
router.patch('/:id', allowRoles('admin', 'staff', 'teacher', 'parent'), P('pickup', 'manage'), versionGuard(PickupAuthorization, { label: 'pickup authorization', lock: 'pickup' }), ctrl.updateAuthorization);
// Verifying a pickup at release is the module's approval step.
router.post('/:id/verify', allowRoles('teacher', 'admin', 'staff'), P('pickup', 'approve'), ctrl.verifyAuthorization);
router.delete('/:id', allowRoles('admin', 'staff', 'teacher', 'parent'), P('pickup', 'manage'), ctrl.deleteAuthorization);

module.exports = router;
