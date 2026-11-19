const router = require('express').Router();
const { protect, allowRoles, requirePermission: P } = require('../middleware/auth');
const { uploadStudentPhoto } = require('../middleware/studentPhotoUpload');
const ctrl = require('../controllers/studentController');
const Student = require('../models/Student');
const { versionGuard } = require('../middleware/concurrency');

// Parents may change their own child's photo with limited access; staff need full Students access.
function photoPermission(req, res, next) {
  return P('students', req.user.role === 'parent' ? 'view' : 'manage')(req, res, next);
}

router.use(protect);
// The student list and profile are shared lookups used by Attendance, Progress, Fees, Pickup and
// Messages; the data is already limited to the account's own students (teacher/parent).
router.get('/', ctrl.listStudents);
router.get('/archived', allowRoles('admin'), P('students', 'manage'), ctrl.listArchivedStudents);
router.get('/:id/photo', ctrl.getStudentPhoto);
router.put('/:id/photo', allowRoles('admin', 'teacher', 'parent'), photoPermission, uploadStudentPhoto('photo'), ctrl.updateStudentPhoto);
router.get('/:id', ctrl.getStudent);
router.post('/', allowRoles('admin'), P('students', 'manage'), ctrl.createStudent);
router.patch('/:id', allowRoles('admin', 'teacher'), P('students', 'manage'), versionGuard(Student, { label: 'student record', lock: 'student' }), ctrl.updateStudent);
router.patch('/:id/archive', allowRoles('admin'), P('students', 'manage'), ctrl.archiveStudent);
router.patch('/:id/restore', allowRoles('admin'), P('students', 'manage'), ctrl.restoreStudent);
router.delete('/:id', allowRoles('admin'), P('students', 'manage'), ctrl.deleteArchivedStudent);

module.exports = router;
