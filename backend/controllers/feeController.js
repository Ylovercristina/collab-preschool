const Fee = require('../models/Fee');
const Payment = require('../models/Payment');
const Student = require('../models/Student');
const Notification = require('../models/Notification');
const ReceiptCounter = require('../models/ReceiptCounter');
const logActivity = require('../utils/logActivity');

function formatMoney(value) {
  return `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function paymentStatus(totalPaid, totalFee) {
  if (totalPaid <= 0) return 'unpaid';
  return totalPaid >= totalFee ? 'paid' : 'partial';
}

async function nextReceiptNumber(datePaid) {
  const year = datePaid.getFullYear();
  const counterId = `OR-${year}`;
  const existingCounter = await ReceiptCounter.findById(counterId);
  if (!existingCounter) {
    const pattern = new RegExp(`^OR-${year}-(\\d+)$`);
    const existingNumbers = await Payment.find({ receiptNumber: pattern }).select('receiptNumber');
    const highestExisting = existingNumbers.reduce((highest, payment) => {
      const sequence = Number(payment.receiptNumber.match(pattern)?.[1] || 0);
      return Math.max(highest, sequence);
    }, 0);
    try {
      await ReceiptCounter.create({ _id: counterId, sequence: highestExisting });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  const counter = await ReceiptCounter.findOneAndUpdate(
    { _id: counterId },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return `OR-${year}-${String(counter.sequence).padStart(4, '0')}`;
}

async function notifyParentOfPayment(fee, payment, totalPaid, action) {
  try {
    const student = await Student.findById(fee.student).select('parent');
    if (!student || !student.parent) return;

    const remaining = Math.max(0, Number((fee.amount - totalPaid).toFixed(2)));
    const dueDate = fee.dueDate.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    let title;
    let message;
    if (action === 'deleted') {
      title = 'Payment record updated';
      message = `A payment record for ${fee.description} was removed. Total paid: ${formatMoney(totalPaid)}. Remaining balance: ${formatMoney(remaining)}. Due date: ${dueDate}.`;
    } else if (remaining === 0) {
      title = action === 'recorded' ? 'Fee fully paid' : 'Payment record updated';
      message = `Your fee for ${fee.description} is fully paid. Thank you.`;
    } else if (action === 'updated') {
      title = 'Payment record updated';
      message = `A recorded cash payment for ${fee.description} was updated. Total paid: ${formatMoney(totalPaid)}. Remaining balance: ${formatMoney(remaining)}. Due date: ${dueDate}.`;
    } else {
      title = action === 'recorded' ? 'Cash payment received' : 'Payment record updated';
      message = `Payment of ${formatMoney(payment.amountPaid)} received for ${fee.description}. Remaining balance: ${formatMoney(remaining)}. Due date: ${dueDate}.`;
    }

    await Notification.findOneAndUpdate(
      { payment: payment._id, parent: student.parent },
      { $set: { student: student._id, fee: fee._id, title, message, readAt: null } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    console.error('[notification] Could not update payment notification:', err.message);
  }
}

async function includePaymentHistory(fees) {
  if (!fees.length) return fees;
  const payments = await Payment.find({ fee: { $in: fees.map((fee) => fee._id) } })
    .populate('loggedBy', 'name')
    .sort({ datePaid: -1 });
  const paymentsByFee = new Map();
  payments.forEach((payment) => {
    const key = String(payment.fee);
    if (!paymentsByFee.has(key)) paymentsByFee.set(key, []);
    paymentsByFee.get(key).push(payment);
  });
  for (const fee of fees) {
    const feePayments = paymentsByFee.get(String(fee._id)) || [];
    const chronologicalPayments = [...feePayments].sort((a, b) => new Date(a.datePaid) - new Date(b.datePaid) || new Date(a.createdAt) - new Date(b.createdAt));
    const studentId = fee.student && fee.student._id ? fee.student._id : fee.student;
    const student = await Student.findById(studentId).select('name className');
    let totalPaidThroughDate = 0;
    for (const payment of chronologicalPayments) {
      const isActive = payment.receiptState !== 'voided';
      if (isActive) totalPaidThroughDate = Number((totalPaidThroughDate + Number(payment.amountPaid || 0)).toFixed(2));
      if (payment.receiptSnapshot && payment.receiptNumber) continue;

      const receiptNumber = payment.receiptNumber || await nextReceiptNumber(new Date(payment.datePaid));
      const remainingBalance = Math.max(0, Number((fee.amount - totalPaidThroughDate).toFixed(2)));
      const receiptSnapshot = {
        datePaid: payment.datePaid,
        schoolName: 'Play-is-School',
        studentName: student ? student.name : 'Student',
        gradeSection: student && student.className ? student.className : 'Not specified',
        feeName: fee.description,
        amountPaid: payment.amountPaid,
        method: 'Cash',
        totalFee: fee.amount,
        totalPaid: totalPaidThroughDate,
        remainingBalance,
        dueDate: remainingBalance > 0 ? fee.dueDate : null,
        status: remainingBalance === 0 ? 'Paid' : 'Partial Payment',
        recordedBy: payment.loggedBy && payment.loggedBy.name ? payment.loggedBy.name : 'School admin',
      };
      await Payment.updateOne(
        { _id: payment._id, $or: [{ receiptNumber: { $exists: false } }, { receiptNumber: '' }, { receiptSnapshot: { $exists: false } }] },
        { $set: { receiptNumber, receiptSnapshot, method: 'Cash', receiptState: payment.receiptState || 'issued' } }
      );
      payment.receiptNumber = receiptNumber;
      payment.receiptSnapshot = receiptSnapshot;
    }
  }
  return fees.map((fee) => {
    const feePayments = paymentsByFee.get(String(fee._id)) || [];
    const totalPaid = Number(feePayments
      .filter((payment) => payment.receiptState !== 'voided')
      .reduce((sum, payment) => sum + Number(payment.amountPaid || 0), 0)
      .toFixed(2));
    return {
      ...fee.toObject(),
      amountPaid: totalPaid,
      status: totalPaid <= 0 ? 'unpaid' : (totalPaid < fee.amount ? 'partial' : 'paid'),
      payments: feePayments,
    };
  });
}

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
  } else if (req.user.role === 'teacher') {
    const student = await Student.findOne({ _id: req.params.studentId, teacher: req.user._id });
    if (!student) return res.status(403).json({ message: 'Not authorized to view this record.' });
  } else if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'You do not have permission to view fee records.' });
  }
  const fees = await Fee.find({ student: req.params.studentId }).sort({ dueDate: 1 });
  const feeHistory = await includePaymentHistory(fees);
  res.json({ fees: req.user.role === 'teacher' ? feeHistory.map(({ payments, ...fee }) => fee) : feeHistory });
};

// GET /api/fees   (admin: all fees, optional ?status=unpaid)
exports.listFees = async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const fees = await Fee.find(filter).populate('student', 'name className').sort({ dueDate: 1 });
  res.json({ fees: await includePaymentHistory(fees) });
};

// GET /api/fees/teacher (fees only for students assigned to this teacher)
exports.listTeacherFees = async (req, res) => {
  const students = await Student.find({ teacher: req.user._id }).select('_id');
  if (!students.length) return res.json({ fees: [] });
  const fees = await Fee.find({ student: { $in: students.map((student) => student._id) } })
    .populate('student', 'name className')
    .sort({ dueDate: 1 });
  const feeSummaries = await includePaymentHistory(fees);
  res.json({ fees: feeSummaries.map(({ payments, ...fee }) => fee) });
};

// POST /api/fees/:id/payments   (admin logs a payment against a fee)
exports.logPayment = async (req, res) => {
  try {
    const fee = await Fee.findById(req.params.id);
    if (!fee) return res.status(404).json({ message: 'Fee record not found.' });

    const { amountPaid, datePaid, remarks } = req.body;
    if ((typeof amountPaid !== 'number' && typeof amountPaid !== 'string') || String(amountPaid).trim() === '') {
      return res.status(400).json({ message: 'Enter a valid payment amount greater than zero.' });
    }

    const numericAmount = Number(amountPaid);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Enter a valid payment amount greater than zero.' });
    }
    const receivedDate = new Date(datePaid);
    if (!datePaid || Number.isNaN(receivedDate.getTime())) {
      return res.status(400).json({ message: 'Enter a valid date received.' });
    }

    const previousPayments = await Payment.find({ fee: fee._id, receiptState: { $ne: 'voided' } });
    const totalPaidSoFar = Number(previousPayments.reduce((sum, payment) => sum + Number(payment.amountPaid || 0), 0).toFixed(2));
    if (totalPaidSoFar !== Number(Number(fee.amountPaid || 0).toFixed(2))) {
      return res.status(409).json({ message: 'Payment records are updating. Refresh the fee and try again.' });
    }
    const remainingBalance = Math.max(0, Number((fee.amount - totalPaidSoFar).toFixed(2)));
    if (remainingBalance === 0) {
      return res.status(400).json({ message: 'This fee is already paid.' });
    }
    if (numericAmount > remainingBalance) {
      const formattedBalance = remainingBalance.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const formattedFee = Number(fee.amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return res.status(400).json({ message: `Payment exceeds the remaining balance of ₱${formattedBalance}. Total paid cannot exceed the total fee of ₱${formattedFee}.` });
    }

    const nextAmountPaid = Number((totalPaidSoFar + numericAmount).toFixed(2));
    const nextStatus = paymentStatus(nextAmountPaid, fee.amount);
    const student = await Student.findById(fee.student).populate('teacher', 'name');
    if (!student) return res.status(404).json({ message: 'Student record not found.' });
    const receiptNumber = await nextReceiptNumber(receivedDate);
    const payment = await Payment.create({
      fee: fee._id,
      amountPaid: numericAmount,
      datePaid: receivedDate,
      method: 'Cash',
      remarks: String(remarks || '').trim(),
      receiptNumber,
      loggedBy: req.user._id,
      receiptSnapshot: {
        datePaid: receivedDate,
        schoolName: 'Play-is-School',
        studentName: student.name,
        gradeSection: student.className || 'Not specified',
        feeName: fee.description,
        amountPaid: numericAmount,
        method: 'Cash',
        totalFee: fee.amount,
        totalPaid: nextAmountPaid,
        remainingBalance: Math.max(0, Number((fee.amount - nextAmountPaid).toFixed(2))),
        dueDate: nextAmountPaid >= fee.amount ? null : fee.dueDate,
        status: nextStatus === 'paid' ? 'Paid' : 'Partial Payment',
        recordedBy: req.user.name,
      },
    });
    const updatedFee = await Fee.findOneAndUpdate(
      { _id: fee._id, amountPaid: fee.amountPaid, updatedAt: fee.updatedAt },
      { $set: { amountPaid: nextAmountPaid, status: nextStatus } },
      { new: true }
    );

    if (!updatedFee) {
      await Payment.deleteOne({ _id: payment._id });
      return res.status(409).json({ message: 'This fee changed while the payment was being recorded. Refresh and try again.' });
    }

    await notifyParentOfPayment(updatedFee, payment, nextAmountPaid, 'recorded');
    await logActivity(req.user._id, 'payment-logged', `${numericAmount} on fee ${updatedFee._id}`);
    res.status(201).json({ fee: updatedFee, payment });
  } catch (err) {
    res.status(500).json({ message: 'Could not log payment.', error: err.message });
  }
};

// PATCH /api/fees/:id/payments/:paymentId (admin corrects a payment record)
exports.updatePayment = async (req, res) => {
  try {
    const fee = await Fee.findById(req.params.id);
    if (!fee) return res.status(404).json({ message: 'Fee record not found.' });
    const payment = await Payment.findOne({ _id: req.params.paymentId, fee: fee._id });
    if (!payment) return res.status(404).json({ message: 'Payment record not found.' });
    if (payment.receiptState === 'voided') return res.status(409).json({ message: 'Voided payment records cannot be edited.' });

    const amountValue = req.body.amountPaid;
    if ((typeof amountValue !== 'number' && typeof amountValue !== 'string') || String(amountValue).trim() === '') {
      return res.status(400).json({ message: 'Enter a valid payment amount greater than zero.' });
    }
    const numericAmount = Number(amountValue);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Enter a valid payment amount greater than zero.' });
    }
    const datePaid = req.body.datePaid === undefined ? payment.datePaid : new Date(req.body.datePaid);
    if (Number.isNaN(new Date(datePaid).getTime())) {
      return res.status(400).json({ message: 'Enter a valid date received.' });
    }

    const allPayments = await Payment.find({ fee: fee._id, receiptState: { $ne: 'voided' } });
    const totalPaidSoFar = Number(allPayments.reduce((sum, item) => sum + Number(item.amountPaid || 0), 0).toFixed(2));
    if (totalPaidSoFar !== Number(Number(fee.amountPaid || 0).toFixed(2))) {
      return res.status(409).json({ message: 'Payment records are updating. Refresh the fee and try again.' });
    }
    const totalPaidWithoutThisPayment = Number((totalPaidSoFar - Number(payment.amountPaid)).toFixed(2));
    const remainingBalance = Math.max(0, Number((fee.amount - totalPaidWithoutThisPayment).toFixed(2)));
    if (numericAmount > remainingBalance) {
      return res.status(400).json({ message: `Payment exceeds the remaining balance of ${formatMoney(remainingBalance)}. Total paid cannot exceed the total fee of ${formatMoney(fee.amount)}.` });
    }

    const nextAmountPaid = Number((totalPaidWithoutThisPayment + numericAmount).toFixed(2));
    const updatedFee = await Fee.findOneAndUpdate(
      { _id: fee._id, amountPaid: fee.amountPaid, updatedAt: fee.updatedAt },
      { $set: { amountPaid: nextAmountPaid, status: paymentStatus(nextAmountPaid, fee.amount) } },
      { new: true }
    );
    if (!updatedFee) return res.status(409).json({ message: 'This fee changed while the payment was being updated. Refresh and try again.' });

    const updatedPayment = await Payment.findOneAndUpdate(
      { _id: payment._id, fee: fee._id },
      {
        $set: {
          amountPaid: numericAmount,
          datePaid,
          method: 'Cash',
          remarks: String(req.body.remarks || '').trim(),
          receiptState: 'corrected',
        },
      },
      { new: true }
    );
    if (!updatedPayment) {
      await Fee.findOneAndUpdate(
        { _id: fee._id, amountPaid: nextAmountPaid, updatedAt: updatedFee.updatedAt },
        { $set: { amountPaid: totalPaidSoFar, status: paymentStatus(totalPaidSoFar, fee.amount) } }
      );
      return res.status(404).json({ message: 'Payment record not found.' });
    }

    await notifyParentOfPayment(updatedFee, updatedPayment, nextAmountPaid, 'updated');
    await logActivity(req.user._id, 'payment-updated', `${updatedPayment._id} on fee ${fee._id}`);
    res.json({ fee: updatedFee, payment: updatedPayment });
  } catch (err) {
    res.status(500).json({ message: 'Could not update payment.', error: err.message });
  }
};

// DELETE /api/fees/:id/payments/:paymentId (admin removes a payment record)
exports.deletePayment = async (req, res) => {
  try {
    const fee = await Fee.findById(req.params.id);
    if (!fee) return res.status(404).json({ message: 'Fee record not found.' });
    const payment = await Payment.findOne({ _id: req.params.paymentId, fee: fee._id });
    if (!payment) return res.status(404).json({ message: 'Payment record not found.' });
    if (payment.receiptState === 'voided') return res.status(409).json({ message: 'This payment is already voided.' });

    const allPayments = await Payment.find({ fee: fee._id, receiptState: { $ne: 'voided' } });
    const totalPaidSoFar = Number(allPayments.reduce((sum, item) => sum + Number(item.amountPaid || 0), 0).toFixed(2));
    if (totalPaidSoFar !== Number(Number(fee.amountPaid || 0).toFixed(2))) {
      return res.status(409).json({ message: 'Payment records are updating. Refresh the fee and try again.' });
    }
    const nextAmountPaid = Math.max(0, Number((totalPaidSoFar - Number(payment.amountPaid)).toFixed(2)));
    const updatedFee = await Fee.findOneAndUpdate(
      { _id: fee._id, amountPaid: fee.amountPaid, updatedAt: fee.updatedAt },
      { $set: { amountPaid: nextAmountPaid, status: paymentStatus(nextAmountPaid, fee.amount) } },
      { new: true }
    );
    if (!updatedFee) return res.status(409).json({ message: 'This fee changed while the payment was being deleted. Refresh and try again.' });

    const voidedPayment = await Payment.findOneAndUpdate(
      { _id: payment._id, fee: fee._id, receiptState: { $ne: 'voided' } },
      { $set: { receiptState: 'voided', voidedAt: new Date() } },
      { new: true }
    );
    if (!voidedPayment) {
      await Fee.findOneAndUpdate(
        { _id: fee._id, amountPaid: nextAmountPaid, updatedAt: updatedFee.updatedAt },
        { $set: { amountPaid: totalPaidSoFar, status: paymentStatus(totalPaidSoFar, fee.amount) } }
      );
      return res.status(404).json({ message: 'Payment record not found.' });
    }

    await notifyParentOfPayment(updatedFee, voidedPayment, nextAmountPaid, 'deleted');
    await logActivity(req.user._id, 'payment-deleted', `${payment._id} on fee ${fee._id}`);
    res.json({ fee: updatedFee });
  } catch (err) {
    res.status(500).json({ message: 'Could not delete payment.', error: err.message });
  }
};

// GET /api/fees/:id/payments/:paymentId/receipt
exports.getReceipt = async (req, res) => {
  try {
    if (!['admin', 'parent'].includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to view receipts.' });
    }
    const fee = await Fee.findById(req.params.id);
    if (!fee) return res.status(404).json({ message: 'Fee record not found.' });
    if (req.user.role === 'parent') {
      const student = await Student.findOne({ _id: fee.student, parent: req.user._id });
      if (!student) return res.status(403).json({ message: 'Not authorized to view this receipt.' });
    }
    await includePaymentHistory([fee]);
    const payment = await Payment.findOne({ _id: req.params.paymentId, fee: fee._id }).populate('loggedBy', 'name');
    if (!payment) return res.status(404).json({ message: 'Payment record not found.' });
    res.json({
      receipt: payment.receiptSnapshot,
      receiptNumber: payment.receiptNumber,
      state: payment.receiptState,
      voidedAt: payment.voidedAt,
    });
  } catch (err) {
    res.status(500).json({ message: 'Could not load receipt.', error: err.message });
  }
};

// GET /api/fees/:id/payments
exports.listPayments = async (req, res) => {
  const payments = await Payment.find({ fee: req.params.id }).populate('loggedBy', 'name').sort({ datePaid: -1 });
  res.json({ payments });
};
