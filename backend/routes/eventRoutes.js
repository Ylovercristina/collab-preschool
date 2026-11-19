const router = require('express').Router();
const { protect, allowRoles, requirePermission: P } = require('../middleware/auth');
const ctrl = require('../controllers/eventController');
const Event = require('../models/Event');
const { versionGuard } = require('../middleware/concurrency');

router.use(protect);
router.get('/', P('events', 'view'), ctrl.listEvents);
router.post('/', allowRoles('admin', 'staff', 'teacher'), P('events', 'manage'), ctrl.createEvent);
router.get('/:id/email-summary', allowRoles('admin', 'staff', 'teacher'), P('events', 'view'), ctrl.emailSummary);
router.patch('/:id/review', allowRoles('admin', 'staff'), P('events', 'approve'), ctrl.reviewEvent);
router.put('/:id/approve', allowRoles('admin', 'staff'), P('events', 'approve'), ctrl.approveEvent);
router.patch('/:id', allowRoles('admin', 'staff', 'teacher'), P('events', 'manage'), versionGuard(Event, { label: 'event', lock: 'event' }), ctrl.updateEvent);
router.delete('/:id', allowRoles('admin', 'staff', 'teacher'), P('events', 'manage'), ctrl.deleteEvent);

module.exports = router;
