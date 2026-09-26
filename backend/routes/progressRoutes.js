const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/progressController');

router.use(protect);
router.post('/', allowRoles('teacher'), ctrl.addProgress);
router.patch('/:id', allowRoles('teacher'), ctrl.updateProgress);
router.get('/student/:studentId', ctrl.getStudentProgress);

module.exports = router;
