const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/pickupController');

router.use(protect);
router.post('/', allowRoles('admin', 'teacher', 'parent'), ctrl.addAuthorization);
router.get('/student/:studentId', ctrl.getStudentAuthorizations);
router.patch('/:id', allowRoles('admin', 'teacher', 'parent'), ctrl.updateAuthorization);
router.post('/:id/verify', allowRoles('teacher', 'admin'), ctrl.verifyAuthorization);
router.delete('/:id', allowRoles('admin', 'teacher', 'parent'), ctrl.deleteAuthorization);

module.exports = router;
