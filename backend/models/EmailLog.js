const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema(
  {
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    type: { type: String, enum: ['event', 'emergency', 'fee'], required: true, index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null, index: true },
    alert: { type: mongoose.Schema.Types.ObjectId, ref: 'EmergencyAlert', default: null, index: true },
    fee: { type: mongoose.Schema.Types.ObjectId, ref: 'Fee', default: null, index: true },
    notification: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification', default: null, index: true },
    status: { type: String, enum: ['sent', 'failed', 'skipped'], required: true, index: true },
    errorMessage: { type: String, trim: true, default: '' },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmailLog', emailLogSchema);