const router = require('express').Router();
const { protect, allowRoles, requirePermission: P, requireAnyPermission } = require('../middleware/auth');
const profileUpload = require('../middleware/profileUpload');
const ctrl = require('../controllers/userController');

function uploadProfileImage(req, res, next) {
  profileUpload.single('avatar')(req, res, (err) => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      message: err.code === 'LIMIT_FILE_SIZE'
        ? 'Profile image must be 2 MB or smaller.'
        : err.message,
    });
  });
}

const mongoose = require('mongoose');
const User = require('../models/User');
const { positionForUser, isOfficeRole } = require('../config/permissions');
const { versionGuard } = require('../middleware/concurrency');
const guardAccountVersion = versionGuard(User, { label: 'account', lock: 'user' });

const isSystemAdmin = (user) => user.role === 'admin' && positionForUser(user) === 'system_admin';
const onlySystemAdmin = (res, message) => res.status(403).json({ code: 'PERMISSION_DENIED', message });

// Admin and staff (office) accounts can only be created, changed, archived or deleted by a System Administrator,
// and account types (roles) can only be changed by one too — never on your own account.
async function guardAccountChanges(req, res, next) {
  try {
    if (isSystemAdmin(req.user)) {
      if (req.params.id && String(req.params.id) === String(req.user._id) && req.body && req.body.role && req.body.role !== req.user.role) {
        return onlySystemAdmin(res, 'You cannot change your own account type.');
      }
      return next();
    }
    if (req.method === 'POST' && !req.params.id && req.body && isOfficeRole(req.body.role)) {
      return onlySystemAdmin(res, 'Only a System Administrator can create administrator or staff accounts.');
    }
    if (req.body && req.body.role !== undefined && req.method === 'PATCH' && req.params.id) {
      return onlySystemAdmin(res, 'Only a System Administrator can change an account type.');
    }
    if (req.params.id && mongoose.isObjectIdOrHexString(req.params.id)) {
      const target = await User.findById(req.params.id).select('role');
      if (target && isOfficeRole(target.role)) {
        return onlySystemAdmin(res, 'Only a System Administrator can change administrator or staff accounts.');
      }
    }
    return next();
  } catch (err) {
    return res.status(500).json({ message: 'Could not check your permissions.' });
  }
}

router.get('/me', protect, ctrl.getMyProfile);
router.put('/me', protect, uploadProfileImage, ctrl.updateMyProfile);

// Student and class forms read the parent/teacher lists, so those managers (admin or staff) may list accounts too.
router.get('/', protect, allowRoles('admin', 'staff'), requireAnyPermission(['users', 'view'], ['students', 'manage'], ['records', 'manage'], ['classes', 'view']), ctrl.listUsers);
router.use(protect, allowRoles('admin'));
router.post('/', P('users', 'manage'), guardAccountChanges, ctrl.createUser);
router.get('/archived', P('users', 'view'), ctrl.listArchivedUsers);
router.get('/:id', P('users', 'view'), ctrl.getUserForEdit);
router.delete('/:id', P('users', 'manage'), guardAccountChanges, ctrl.deleteArchivedUser);
router.put('/:id', P('users', 'manage'), guardAccountChanges, guardAccountVersion, uploadProfileImage, ctrl.updateUserProfile);
router.patch('/:id', P('users', 'manage'), guardAccountChanges, guardAccountVersion, ctrl.updateUser);
router.patch('/:id/archive', P('users', 'manage'), guardAccountChanges, ctrl.archiveUser);
router.patch('/:id/approve', P('users', 'approve'), ctrl.approveUser);
router.patch('/:id/reject', P('users', 'approve'), ctrl.rejectUser);
router.patch('/:id/reactivate', P('users', 'manage'), guardAccountChanges, ctrl.reactivateUser);
router.patch('/:id/verify-email', P('users', 'manage'), ctrl.verifyParentEmail);

module.exports = router;
