const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/reportController');

router.use(protect, allowRoles('admin'));
router.get('/students', ctrl.studentReport);
router.get('/fees', ctrl.feeReport);
router.get('/attendance', ctrl.attendanceReport);

module.exports = router;
