const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/attendanceController');

router.use(protect);
router.post('/', allowRoles('teacher'), ctrl.markAttendance);
router.post('/bulk', allowRoles('teacher'), ctrl.markAttendanceBulk);
router.get('/class', allowRoles('teacher'), ctrl.getClassAttendance);
router.get('/class/report', allowRoles('teacher'), ctrl.getClassAttendanceReport);
router.get('/student/:studentId', ctrl.getStudentAttendance);

module.exports = router;
