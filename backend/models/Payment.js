const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    fee: { type: mongoose.Schema.Types.ObjectId, ref: 'Fee', required: true },
    amountPaid: { type: Number, required: true, min: 0 },
    datePaid: { type: Date, default: Date.now },
    method: { type: String, trim: true, default: 'cash' },
    loggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);
