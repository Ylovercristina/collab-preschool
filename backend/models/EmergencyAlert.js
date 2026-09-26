const mongoose = require('mongoose');

const emergencyAlertSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmergencyAlert', emergencyAlertSchema);
