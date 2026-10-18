const router = require('express').Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/messageController');

router.use(protect);
router.get('/inbox', ctrl.getInbox);
router.get('/contacts', ctrl.getContacts);
router.post('/groups', ctrl.createGroup);
router.get('/groups/:groupId', ctrl.getGroup);
router.post('/groups/:groupId/messages', ctrl.sendGroupMessage);
router.get('/thread/:userId', ctrl.getThread);
router.post('/', ctrl.sendMessage);

module.exports = router;
