const router = require('express').Router();
const { protect, requirePermission: P } = require('../middleware/auth');
const ctrl = require('../controllers/messageController');

router.use(protect);
router.get('/inbox', P('messages', 'view'), ctrl.getInbox);
router.get('/contacts', P('messages', 'view'), ctrl.getContacts);
router.post('/groups', P('messages', 'manage'), ctrl.createGroup);
router.patch('/groups/:groupId', P('messages', 'manage'), ctrl.renameGroup);
router.get('/groups/:groupId', P('messages', 'view'), ctrl.getGroup);
router.post('/groups/:groupId/messages', P('messages', 'manage'), ctrl.sendGroupMessage);
router.get('/thread/:userId', P('messages', 'view'), ctrl.getThread);
router.post('/', P('messages', 'manage'), ctrl.sendMessage);

module.exports = router;
