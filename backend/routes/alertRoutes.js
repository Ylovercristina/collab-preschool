const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/alertController');

router.use(protect);
router.get('/', ctrl.listAlerts);
router.get('/:id/email-summary', allowRoles('admin', 'teacher'), ctrl.getEmailSummary);
router.patch('/:id/archive', allowRoles('admin', 'teacher'), ctrl.archiveAlert);
router.patch('/:id/restore', allowRoles('admin', 'teacher'), ctrl.restoreAlert);
router.delete('/:id', allowRoles('admin', 'teacher'), ctrl.deleteArchivedAlert);
router.patch('/:id/acknowledge', allowRoles('parent'), ctrl.acknowledge);
router.post('/', allowRoles('admin', 'teacher'), ctrl.createAlert);
router.post('/:id/updates', allowRoles('admin', 'teacher'), ctrl.addUpdate);

module.exports = router;
