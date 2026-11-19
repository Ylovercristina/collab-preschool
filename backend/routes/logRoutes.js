const router = require('express').Router();
const { protect, allowRoles, requirePermission: P } = require('../middleware/auth');
const ctrl = require('../controllers/logController');

router.use(protect, allowRoles('admin', 'staff'), P('logs', 'view'));
router.get('/', ctrl.listLogs);

module.exports = router;
