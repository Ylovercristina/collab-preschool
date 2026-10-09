const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/notificationController');

router.use(protect, allowRoles('parent'));
router.get('/', ctrl.listMyNotifications);
router.patch('/:id/read', ctrl.markRead);

module.exports = router;
