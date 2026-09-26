const router = require('express').Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/authController');

router.post('/signup', ctrl.signup);
router.post('/login', ctrl.login);
router.post('/logout', protect, ctrl.logout);
router.get('/me', protect, ctrl.me);
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/reset-password', ctrl.resetPassword);

module.exports = router;
