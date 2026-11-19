const router = require('express').Router();
const { protect, allowRoles, requirePermission: P, requireAnyPermission } = require('../middleware/auth');
const ctrl = require('../controllers/reportController');

router.use(protect, allowRoles('admin'));
// Student counts appear on the dashboard; fee and attendance totals need Reports or Fees access.
router.get('/students', requireAnyPermission(['reports', 'view'], ['dashboard', 'view']), ctrl.studentReport);
router.get('/fees', requireAnyPermission(['reports', 'view'], ['fees', 'view']), ctrl.feeReport);
router.get('/attendance', P('reports', 'view'), ctrl.attendanceReport);

module.exports = router;
