const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['fee', 'event', 'emergency', 'attendance'], default: 'fee', index: true },
    priority: { type: Number, default: 0, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    fee: { type: mongoose.Schema.Types.ObjectId, ref: 'Fee' },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
    alert: { type: mongoose.Schema.Types.ObjectId, ref: 'EmergencyAlert' },
    alertUpdate: { type: mongoose.Schema.Types.ObjectId, default: null },
    attendance: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance' },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index(
  { parent: 1, attendance: 1 },
  { unique: true, partialFilterExpression: { type: 'attendance' } }
);

module.exports = mongoose.model('Notification', notificationSchema);
