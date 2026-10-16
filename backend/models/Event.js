const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    date: { type: Date, required: true },
    time: { type: String, trim: true, default: '' },
    venue: { type: String, trim: true, default: '' },
    targetType: { type: String, enum: ['all', 'classes'], default: 'all' },
    targetClasses: [{ type: String, trim: true }],
    publicationStatus: { type: String, enum: ['draft', 'pending', 'published', 'rejected'], default: 'published', index: true },
    reviewStatus: { type: String, enum: ['not-required', 'pending', 'publishing', 'approved', 'rejected'], default: 'not-required', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNotes: { type: String, trim: true, default: '' },
    emailRecipientCount: { type: Number, default: 0 },
    audience: { type: String, enum: ['all', 'teachers', 'parents'], default: 'parents' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Event', eventSchema);
