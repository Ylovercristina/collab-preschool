const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/studentController');

router.use(protect);
router.get('/', ctrl.listStudents);
router.get('/:id', ctrl.getStudent);
router.post('/', allowRoles('admin', 'teacher'), ctrl.createStudent);
router.patch('/:id', allowRoles('admin', 'teacher'), ctrl.updateStudent);
router.patch('/:id/archive', allowRoles('admin'), ctrl.archiveStudent);

module.exports = router;
