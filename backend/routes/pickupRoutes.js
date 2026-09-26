const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/pickupController');

router.use(protect);
router.post('/', allowRoles('parent', 'admin'), ctrl.addAuthorization);
router.get('/student/:studentId', ctrl.getStudentAuthorizations);
router.post('/:id/verify', allowRoles('teacher', 'admin'), ctrl.verifyAuthorization);
router.delete('/:id', allowRoles('parent', 'admin'), ctrl.deleteAuthorization);

module.exports = router;
