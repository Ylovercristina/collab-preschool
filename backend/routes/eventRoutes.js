const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/eventController');

router.use(protect);
router.get('/', ctrl.listEvents);
router.post('/', allowRoles('admin', 'teacher'), ctrl.createEvent);
router.patch('/:id', allowRoles('admin', 'teacher'), ctrl.updateEvent);
router.delete('/:id', allowRoles('admin'), ctrl.deleteEvent);

module.exports = router;
