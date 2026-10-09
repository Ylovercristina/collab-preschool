const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/feeController');

router.use(protect);
router.get('/', allowRoles('admin'), ctrl.listFees);
router.get('/teacher', allowRoles('teacher'), ctrl.listTeacherFees);
router.post('/', allowRoles('admin'), ctrl.createFee);
router.get('/student/:studentId', ctrl.getStudentFees);
router.post('/:id/payments', allowRoles('admin'), ctrl.logPayment);
router.patch('/:id/payments/:paymentId', allowRoles('admin'), ctrl.updatePayment);
router.delete('/:id/payments/:paymentId', allowRoles('admin'), ctrl.deletePayment);
router.get('/:id/payments/:paymentId/receipt', allowRoles('admin', 'parent'), ctrl.getReceipt);
router.get('/:id/payments', allowRoles('admin'), ctrl.listPayments);

module.exports = router;
