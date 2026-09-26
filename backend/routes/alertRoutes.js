const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/alertController');

router.use(protect);
router.get('/', ctrl.listAlerts);
router.post('/', allowRoles('admin', 'teacher'), ctrl.createAlert);

module.exports = router;
