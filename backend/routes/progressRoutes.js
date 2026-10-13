const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/progressController');

router.use(protect);
router.get('/', allowRoles('admin'), ctrl.listAllProgress);
router.patch('/:id/review', allowRoles('admin'), ctrl.reviewProgress);
router.post('/', allowRoles('teacher'), ctrl.addProgress);
router.patch('/:id', allowRoles('teacher'), ctrl.updateProgress);
router.get('/student/:studentId', ctrl.getStudentProgress);

module.exports = router;
