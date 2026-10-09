const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
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

router.get('/me', protect, ctrl.getMyProfile);
router.put('/me', protect, uploadProfileImage, ctrl.updateMyProfile);

router.use(protect, allowRoles('admin'));
router.get('/', ctrl.listUsers);
router.post('/', ctrl.createUser);
router.get('/:id', ctrl.getUserForEdit);
router.put('/:id', uploadProfileImage, ctrl.updateUserProfile);
router.patch('/:id', ctrl.updateUser);
router.patch('/:id/archive', ctrl.archiveUser);
router.patch('/:id/approve', ctrl.approveUser);
router.patch('/:id/reactivate', ctrl.reactivateUser);

module.exports = router;
