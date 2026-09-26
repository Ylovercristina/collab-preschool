const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/userController');

router.use(protect, allowRoles('admin'));
router.get('/', ctrl.listUsers);
router.post('/', ctrl.createUser);
router.patch('/:id', ctrl.updateUser);
router.patch('/:id/archive', ctrl.archiveUser);
router.patch('/:id/approve', ctrl.approveUser);
router.patch('/:id/reactivate', ctrl.reactivateUser);

module.exports = router;
