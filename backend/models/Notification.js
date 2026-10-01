const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    fee: { type: mongoose.Schema.Types.ObjectId, ref: 'Fee', required: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
