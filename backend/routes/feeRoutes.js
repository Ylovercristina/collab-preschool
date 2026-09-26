const router = require('express').Router();
const { protect, allowRoles } = require('../middleware/auth');
const ctrl = require('../controllers/feeController');

router.use(protect);
router.get('/', allowRoles('admin'), ctrl.listFees);
router.post('/', allowRoles('admin'), ctrl.createFee);
router.get('/student/:studentId', ctrl.getStudentFees);
router.post('/:id/payments', allowRoles('admin'), ctrl.logPayment);
router.get('/:id/payments', allowRoles('admin'), ctrl.listPayments);

module.exports = router;
