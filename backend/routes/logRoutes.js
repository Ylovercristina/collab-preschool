const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/logController');

router.use(protect, allowRoles('admin'));
router.get('/', ctrl.listLogs);

module.exports = router;
