const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    fee: { type: mongoose.Schema.Types.ObjectId, ref: 'Fee', required: true },
    amountPaid: { type: Number, required: true, min: 0.01 },
    datePaid: { type: Date, default: Date.now },
    method: { type: String, enum: ['Cash'], default: 'Cash' },
    remarks: { type: String, trim: true, default: '' },
    receiptNumber: { type: String, trim: true, default: undefined },
    receiptState: { type: String, enum: ['issued', 'corrected', 'voided'], default: 'issued' },
    voidedAt: { type: Date, default: null },
    receiptSnapshot: {
      datePaid: Date,
      schoolName: String,
      studentName: String,
      gradeSection: String,
      feeName: String,
      amountPaid: Number,
      method: { type: String, enum: ['Cash'] },
      totalFee: Number,
      totalPaid: Number,
      remainingBalance: Number,
      dueDate: Date,
      status: { type: String, enum: ['Partial Payment', 'Paid'] },
      recordedBy: String,
    },
    loggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);
