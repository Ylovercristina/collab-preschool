const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const { uploadStudentPhoto } = require('../middleware/studentPhotoUpload');
const ctrl = require('../controllers/studentController');

router.use(protect);
router.get('/', ctrl.listStudents);
router.get('/:id/photo', ctrl.getStudentPhoto);
router.put('/:id/photo', allowRoles('admin', 'teacher', 'parent'), uploadStudentPhoto('photo'), ctrl.updateStudentPhoto);
router.get('/:id', ctrl.getStudent);
router.post('/', allowRoles('admin'), ctrl.createStudent);
router.patch('/:id', allowRoles('admin', 'teacher'), ctrl.updateStudent);
router.patch('/:id/archive', allowRoles('admin'), ctrl.archiveStudent);

module.exports = router;
