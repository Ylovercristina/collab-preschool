const router = require('express').Router();
const { protect, allowRoles, requirePermission: P } = require('../middleware/auth');
const ctrl = require('../controllers/alertController');

router.use(protect);
router.get('/', P('alerts', 'view'), ctrl.listAlerts);
router.get('/:id/email-summary', allowRoles('admin', 'staff', 'teacher'), P('alerts', 'view'), ctrl.getEmailSummary);
router.patch('/:id/archive', allowRoles('admin', 'staff', 'teacher'), P('alerts', 'manage'), ctrl.archiveAlert);
router.patch('/:id/restore', allowRoles('admin', 'staff', 'teacher'), P('alerts', 'manage'), ctrl.restoreAlert);
router.delete('/:id', allowRoles('admin', 'staff', 'teacher'), P('alerts', 'manage'), ctrl.deleteArchivedAlert);
// Acknowledging an alert about your own child is part of limited (view) access.
router.patch('/:id/acknowledge', allowRoles('parent'), P('alerts', 'view'), ctrl.acknowledge);
router.post('/', allowRoles('admin', 'staff', 'teacher'), P('alerts', 'manage'), ctrl.createAlert);
router.post('/:id/updates', allowRoles('admin', 'staff', 'teacher'), P('alerts', 'manage'), ctrl.addUpdate);

module.exports = router;
