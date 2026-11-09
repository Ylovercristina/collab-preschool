const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/calendarController');

// Google redirects the browser here without a Bearer token; the one-time OAuth state identifies the admin.
router.get('/google/callback', ctrl.callback);

router.use(protect);
router.get('/google/personal/status', ctrl.personalStatus);
router.post('/google/personal/connect', ctrl.personalConnect);
router.post('/google/personal/sync', ctrl.syncPersonalEvents);
router.post('/google/personal/events/:id', ctrl.addPersonalEvent);
router.delete('/google/personal/events/:id', ctrl.removePersonalEvent);
router.delete('/google/personal/connection', ctrl.disconnectPersonal);

router.use(allowRoles('admin'));
router.get('/google/status', ctrl.status);
router.post('/google/connect', ctrl.connect);
router.patch('/google/settings', ctrl.updateSettings);
router.post('/google/sync', ctrl.syncAll);
router.post('/google/events/:id/sync', ctrl.syncEvent);
router.delete('/google/connection', ctrl.disconnect);

module.exports = router;
