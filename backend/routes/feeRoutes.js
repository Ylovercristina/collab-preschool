const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/feeController');

router.use(protect);
router.get('/', allowRoles('admin'), ctrl.listFees);
router.get('/teacher', allowRoles('teacher'), ctrl.listTeacherFees);
router.post('/', allowRoles('admin'), ctrl.createFee);
router.get('/student/:studentId', ctrl.getStudentFees);
router.post('/reminders/all', allowRoles('admin', 'teacher'), ctrl.remindAllParents);
router.post('/:id/reminders', allowRoles('admin', 'teacher'), ctrl.remindParent);
router.get('/:id/reminders/:notificationId/email-summary', allowRoles('admin', 'teacher'), ctrl.reminderEmailSummary);
router.post('/:id/payments', allowRoles('admin'), ctrl.logPayment);
router.patch('/:id/payments/:paymentId', allowRoles('admin'), ctrl.updatePayment);
router.delete('/:id/payments/:paymentId', allowRoles('admin'), ctrl.deletePayment);
router.get('/:id/payments/:paymentId/receipt', allowRoles('admin', 'parent'), ctrl.getReceipt);
router.get('/:id/payments', allowRoles('admin'), ctrl.listPayments);

module.exports = router;
