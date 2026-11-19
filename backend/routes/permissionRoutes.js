const router = require('express').Router();
const { protect, allowRoles, requireSystemAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/permissionController');
const User = require('../models/User');
const { versionGuard } = require('../middleware/concurrency');

router.use(protect);
router.get('/me', ctrl.myPermissions);

// Only a System Administrator can see or change roles and permissions.
router.use(allowRoles('admin'), requireSystemAdmin);
router.get('/', ctrl.overview);
router.put('/roles/:position', ctrl.updateRolePermissions);
router.put('/users/:id', versionGuard(User, { label: 'account', lock: 'user' }), ctrl.updateUserPermissions);

module.exports = router;
