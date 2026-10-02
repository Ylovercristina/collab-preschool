const router = require('express').Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/authController');

router.post('/signup', ctrl.signup);
router.post('/login', ctrl.login);
router.get('/google', ctrl.googleStart);
router.get('/google/callback', ctrl.googleCallback);
router.post('/google/exchange', ctrl.googleExchange);
router.post('/logout', protect, ctrl.logout);
router.get('/me', protect, ctrl.me);
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/verify-reset-otp', ctrl.verifyResetOtp);
router.post('/resend-reset-otp', ctrl.resendResetOtp);
router.post('/reset-password', ctrl.resetPassword);

module.exports = router;
