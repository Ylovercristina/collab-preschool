const mongoose = require('mongoose');

const feeSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

feeSchema.methods.recomputeStatus = function () {
  if (this.amountPaid <= 0) this.status = 'unpaid';
  else if (this.amountPaid < this.amount) this.status = 'partial';
  else this.status = 'paid';
};

module.exports = mongoose.model('Fee', feeSchema);
