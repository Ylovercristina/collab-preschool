const Fee = require('../models/Fee');
const EmailLog = require('../models/EmailLog');
const Payment = require('../models/Payment');
const Student = require('../models/Student');
const Notification = require('../models/Notification');
const ReceiptCounter = require('../models/ReceiptCounter');
const { queueEmailDelivery } = require('../services/emailDelivery');
const logActivity = require('../utils/logActivity');
const mongoose = require('mongoose');

function formatMoney(value) {
  return `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function paymentStatus(totalPaid, totalFee) {
  if (totalPaid <= 0) return 'unpaid';
  return totalPaid >= totalFee ? 'paid' : 'partial';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function feeReminderContent(fee, student, parent, totalPaid) {
  const remaining = Math.max(0, Number((fee.amount - totalPaid).toFixed(2)));
  const dueDate = new Date(fee.dueDate).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  const title = 'Unpaid balance reminder';
  const message = `The remaining balance for ${student.name}'s ${fee.description} is ${formatMoney(remaining)}. Total fee: ${formatMoney(fee.amount)}. Total paid: ${formatMoney(totalPaid)}. Due date: ${dueDate}. Please contact the school if you have already paid.`;
  const dashboardUrl = `${process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500'}/frontend/pages/dashboard-parent.html`;
  const text = [
    `Dear ${parent.name || 'Parent/Guardian'},`,
    '',
    `This is a reminder that ${student.name} has an outstanding balance for ${fee.description}.`,
    `Total fee: ${formatMoney(fee.amount)}`,
    `Total paid: ${formatMoney(totalPaid)}`,
    `Remaining balance: ${formatMoney(remaining)}`,
    `Due date: ${dueDate}`,
    '',
    'Please contact the school if you have already paid or have questions.',
    `Parent dashboard: ${dashboardUrl}`,
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#25332d"><h2>Unpaid balance reminder</h2><p>Dear ${escapeHtml(parent.name || 'Parent/Guardian')},</p><p>This is a reminder that <strong>${escapeHtml(student.name)}</strong> has an outstanding balance for <strong>${escapeHtml(fee.description)}</strong>.</p><p><strong>Total fee:</strong> ${escapeHtml(formatMoney(fee.amount))}<br><strong>Total paid:</strong> ${escapeHtml(formatMoney(totalPaid))}<br><strong>Remaining balance:</strong> ${escapeHtml(formatMoney(remaining))}<br><strong>Due date:</strong> ${escapeHtml(dueDate)}</p><p>Please contact the school if you have already paid or have questions.</p><p><a href="${escapeHtml(dashboardUrl)}">Open the Parent dashboard</a></p></div>`;
  return { remaining, title, message, dueDate, text, html };
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

// POST /api/fees/reminders/all
exports.remindAllParents = async (req, res) => {
  try {
    const studentFilter = req.user.role === 'teacher' ? { teacher: req.user._id } : {};
    const students = await Student.find(studentFilter)
      .select('name className parent teacher')
      .populate('parent', 'name email role status');
    if (!students.length) {
      return res.json({ unpaidFeeCount: 0, remindedCount: 0, skippedCount: 0 });
    }

    const studentById = new Map(students.map((student) => [String(student._id), student]));
    const fees = await Fee.find({ student: { $in: students.map((student) => student._id) } }).sort({ dueDate: 1 });
    if (!fees.length) {
      return res.json({ unpaidFeeCount: 0, remindedCount: 0, skippedCount: 0 });
    }
    const payments = await Payment.find({
      fee: { $in: fees.map((fee) => fee._id) },
      receiptState: { $ne: 'voided' },
    }).select('fee amountPaid');
    const paidByFee = new Map();
    payments.forEach((payment) => {
      const feeId = String(payment.fee);
      paidByFee.set(feeId, Number(((paidByFee.get(feeId) || 0) + Number(payment.amountPaid || 0)).toFixed(2)));
    });

    const reminders = [];
    let unpaidFeeCount = 0;
    let skippedCount = 0;
    for (const fee of fees) {
      const student = studentById.get(String(fee.student));
      if (!student) continue;
      const totalPaid = paidByFee.get(String(fee._id)) || 0;
      const remaining = Math.max(0, Number((fee.amount - totalPaid).toFixed(2)));
      if (remaining <= 0) continue;
      unpaidFeeCount += 1;
      const parent = student.parent;
      if (!parent || parent.role !== 'parent' || parent.status !== 'approved' || !parent.email) {
        skippedCount += 1;
        continue;
      }
      reminders.push({ fee, student, parent, totalPaid });
    }

    if (reminders.length) {
      const createdNotifications = await Notification.insertMany(reminders.map(({ fee, student, parent, totalPaid }) => {
        const content = feeReminderContent(fee, student, parent, totalPaid);
        return {
          parent: parent._id,
          type: 'fee',
          priority: 1,
          student: student._id,
          fee: fee._id,
          title: content.title,
          message: content.message,
        };
      }));
      reminders.forEach(({ fee, student, parent, totalPaid }, index) => {
        const content = feeReminderContent(fee, student, parent, totalPaid);
        queueEmailDelivery({
          parents: [parent],
          type: 'fee',
          feeId: fee._id,
          notificationId: createdNotifications[index]._id,
          subject: `Balance reminder for ${student.name}`,
          text: content.text,
          html: content.html,
        });
      });
      await logActivity(req.user._id, 'fee-reminders-sent', `${createdNotifications.length} unpaid fee reminders sent`);
    }

    res.status(202).json({
      unpaidFeeCount,
      remindedCount: reminders.length,
      skippedCount,
      message: reminders.length
        ? `Created reminders for ${reminders.length} unpaid fee${reminders.length === 1 ? '' : 's'}. Email delivery is processing.`
        : 'No unpaid fees with an active parent email were found.',
    });
  } catch (err) {
    console.error('[fees] Could not send all balance reminders:', err.message);
    res.status(500).json({ message: 'Could not send all balance reminders.' });
  }
};

// POST /api/fees/:id/reminders
exports.remindParent = async (req, res) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      return res.status(404).json({ message: 'Fee record not found.' });
    }
    const fee = await Fee.findById(req.params.id);
    if (!fee) return res.status(404).json({ message: 'Fee record not found.' });

    const student = await Student.findById(fee.student).populate('parent', 'name email role status');
    if (!student) return res.status(404).json({ message: 'Student record not found.' });
    if (req.user.role === 'teacher' && String(student.teacher) !== String(req.user._id)) {
      return res.status(403).json({ message: 'You can only remind parents of students assigned to your class.' });
    }
    if (!student.parent || student.parent.role !== 'parent' || student.parent.status !== 'approved') {
      return res.status(409).json({ message: 'This student does not have an active parent account to notify.' });
    }

    const payments = await Payment.find({ fee: fee._id, receiptState: { $ne: 'voided' } }).select('amountPaid');
    const totalPaid = Number(payments.reduce((sum, payment) => sum + Number(payment.amountPaid || 0), 0).toFixed(2));
    const remaining = Math.max(0, Number((fee.amount - totalPaid).toFixed(2)));
    if (remaining <= 0) return res.status(409).json({ message: 'This fee is already fully paid.' });

    const content = feeReminderContent(fee, student, student.parent, totalPaid);
    const notification = await Notification.create({
      parent: student.parent._id,
      type: 'fee',
      priority: 1,
      student: student._id,
      fee: fee._id,
      title: content.title,
      message: content.message,
    });

    queueEmailDelivery({
      parents: [student.parent],
      type: 'fee',
      feeId: fee._id,
      notificationId: notification._id,
      subject: `Balance reminder for ${student.name}`,
      text: content.text,
      html: content.html,
    });
    await logActivity(req.user._id, 'fee-reminder-sent', `${student.name}: ${formatMoney(remaining)} remaining on fee ${fee._id}`);
    res.status(202).json({
      notification,
      emailSummary: { sent: 0, skipped: 0, failed: 0, expected: 1, complete: false },
    });
  } catch (err) {
    console.error('[fees] Could not send balance reminder:', err.message);
    res.status(500).json({ message: 'Could not send balance reminder.' });
  }
};

// GET /api/fees/:id/reminders/:notificationId/email-summary
exports.reminderEmailSummary = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id) || !mongoose.isObjectIdOrHexString(req.params.notificationId)) {
    return res.status(404).json({ message: 'Fee reminder not found.' });
  }
  const fee = await Fee.findById(req.params.id);
  if (!fee) return res.status(404).json({ message: 'Fee record not found.' });
  const student = await Student.findById(fee.student).select('teacher parent');
  if (!student) return res.status(404).json({ message: 'Student record not found.' });
  if (req.user.role === 'teacher' && String(student.teacher) !== String(req.user._id)) {
    return res.status(403).json({ message: 'You cannot view this delivery summary.' });
  }
  if (!student.parent) return res.status(404).json({ message: 'Fee reminder not found.' });
  const notification = await Notification.findOne({
    _id: req.params.notificationId,
    fee: fee._id,
    parent: student.parent,
    type: 'fee',
  });
  if (!notification) return res.status(404).json({ message: 'Fee reminder not found.' });
  const logs = await EmailLog.find({ notification: notification._id }).select('status');
  const emailSummary = {
    sent: logs.filter((log) => log.status === 'sent').length,
    skipped: logs.filter((log) => log.status === 'skipped').length,
    failed: logs.filter((log) => log.status === 'failed').length,
    expected: 1,
  };
  emailSummary.complete = logs.length >= emailSummary.expected;
  res.json({ emailSummary });
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
