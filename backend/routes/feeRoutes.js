const router = require('express').Router();
const { protect, allowRoles, requirePermission: P } = require('../middleware/auth');
const { versionGuard, exclusiveLock } = require('../middleware/concurrency');
const Fee = require('../models/Fee');
const Payment = require('../models/Payment');
const ctrl = require('../controllers/feeController');
const { limits } = require('../middleware/rateLimit');

// Recording, correcting or voiding a payment reads the fee's balance and then writes; one change per
// fee at a time, so two cashiers can't both pass the balance check and overpay the fee.
const lockFee = exclusiveLock(Fee, {
  field: 'paymentLock',
  ttlMs: 30 * 1000,
  message: 'Another payment for this fee is being saved right now. Wait a moment and try again.',
});

router.use(protect);
router.get('/', allowRoles('admin'), P('fees', 'view'), ctrl.listFees);
router.get('/teacher', allowRoles('teacher'), P('fees', 'view'), ctrl.listTeacherFees);
router.post('/', allowRoles('admin'), P('fees', 'manage'), ctrl.createFee);
router.get('/student/:studentId', P('fees', 'view'), ctrl.getStudentFees);
// Reminding parents about a balance is part of limited (view) access.
router.post('/reminders/all', allowRoles('admin', 'teacher'), P('fees', 'view'), limits.emailBlast, ctrl.remindAllParents);
router.post('/:id/reminders', allowRoles('admin', 'teacher'), P('fees', 'view'), ctrl.remindParent);
router.get('/:id/reminders/:notificationId/email-summary', allowRoles('admin', 'teacher'), P('fees', 'view'), ctrl.reminderEmailSummary);
router.post('/:id/payments', allowRoles('admin'), P('fees', 'manage'), lockFee, ctrl.logPayment);
router.patch('/:id/payments/:paymentId', allowRoles('admin'), P('fees', 'manage'), lockFee, versionGuard(Payment, { param: 'paymentId', label: 'payment', lock: 'payment' }), ctrl.updatePayment);
router.delete('/:id/payments/:paymentId', allowRoles('admin'), P('fees', 'manage'), lockFee, ctrl.deletePayment);
router.get('/:id/payments/:paymentId/receipt', allowRoles('admin', 'parent'), P('fees', 'view'), ctrl.getReceipt);
router.get('/:id/payments', allowRoles('admin'), P('fees', 'view'), ctrl.listPayments);

module.exports = router;
