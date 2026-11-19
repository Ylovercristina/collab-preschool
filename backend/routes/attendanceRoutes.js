const router = require('express').Router();
const { protect, allowRoles, requirePermission: P } = require('../middleware/auth');
const ctrl = require('../controllers/attendanceController');

router.use(protect);
router.post('/', allowRoles('teacher'), P('attendance', 'manage'), ctrl.markAttendance);
router.post('/bulk', allowRoles('teacher'), P('attendance', 'manage'), ctrl.markAttendanceBulk);
router.get('/class', allowRoles('teacher'), P('attendance', 'view'), ctrl.getClassAttendance);
router.get('/class/report', allowRoles('teacher'), P('attendance', 'view'), ctrl.getClassAttendanceReport);
router.get('/student/:studentId', P('attendance', 'view'), ctrl.getStudentAttendance);

module.exports = router;
