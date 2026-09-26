const Fee = require('../models/Fee');
const Payment = require('../models/Payment');
const Student = require('../models/Student');
const logActivity = require('../utils/logActivity');

// POST /api/fees   (admin creates a fee record for a student)
exports.createFee = async (req, res) => {
  try {
    const { student, description, amount, dueDate } = req.body;
    const fee = await Fee.create({ student, description, amount, dueDate, createdBy: req.user._id });
    await logActivity(req.user._id, 'fee-created', `${description} for student ${student}`);
    res.status(201).json({ fee });
  } catch (err) {
    res.status(500).json({ message: 'Could not create fee.', error: err.message });
  }
};

// GET /api/fees/student/:studentId
exports.getStudentFees = async (req, res) => {
  if (req.user.role === 'parent') {
    const student = await Student.findOne({ _id: req.params.studentId, parent: req.user._id });
    if (!student) return res.status(403).json({ message: 'Not authorized to view this record.' });
  }
  const fees = await Fee.find({ student: req.params.studentId }).sort({ dueDate: 1 });
  res.json({ fees });
};

// GET /api/fees   (admin: all fees, optional ?status=unpaid)
exports.listFees = async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const fees = await Fee.find(filter).populate('student', 'name className').sort({ dueDate: 1 });
  res.json({ fees });
};

// POST /api/fees/:id/payments   (admin logs a payment against a fee)
exports.logPayment = async (req, res) => {
  try {
    const fee = await Fee.findById(req.params.id);
    if (!fee) return res.status(404).json({ message: 'Fee record not found.' });

    const { amountPaid, method } = req.body;
    const payment = await Payment.create({ fee: fee._id, amountPaid, method, loggedBy: req.user._id });

    fee.amountPaid += Number(amountPaid);
    fee.recomputeStatus();
    await fee.save();

    await logActivity(req.user._id, 'payment-logged', `${amountPaid} on fee ${fee._id}`);
    res.status(201).json({ fee, payment });
  } catch (err) {
    res.status(500).json({ message: 'Could not log payment.', error: err.message });
  }
};

// GET /api/fees/:id/payments
exports.listPayments = async (req, res) => {
  const payments = await Payment.find({ fee: req.params.id }).sort({ datePaid: -1 });
  res.json({ payments });
};
