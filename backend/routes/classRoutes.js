const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/classController');

router.use(protect, allowRoles('admin'));
router.get('/', ctrl.listClasses);
router.post('/', ctrl.createClass);
router.patch('/:id', ctrl.updateClass);
router.patch('/:id/archive', ctrl.archiveClass);
router.patch('/:id/restore', ctrl.restoreClass);

module.exports = router;
