const mongoose = require('mongoose');

const emergencyAlertSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    emergencyType: { type: String, required: true, trim: true, default: 'General' },
    severity: { type: String, enum: ['low', 'moderate', 'high', 'critical'], default: 'high' },
    description: { type: String, trim: true, default: '' },
    affectedClasses: [{ type: String, trim: true }],
    safetyInstructions: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['active', 'update', 'all-clear', 'archived', 'deleted'], default: 'active', index: true },
    archivedFromStatus: { type: String, enum: ['active', 'update', 'all-clear'], default: 'active' },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
    acknowledgements: [{
      parent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      acknowledgedAt: { type: Date, default: Date.now },
    }],
    emailRecipientCount: { type: Number, default: 0 },
    updates: [{
      message: { type: String, required: true, trim: true },
      status: { type: String, enum: ['update', 'all-clear'], required: true },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      createdAt: { type: Date, default: Date.now },
    }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmergencyAlert', emergencyAlertSchema);
