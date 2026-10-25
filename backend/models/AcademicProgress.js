const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true, trim: true },
    filename: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const academicProgressSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 'activity' = single dated record (original behaviour); weekly/monthly milestones cover a period.
    entryType: { type: String, enum: ['activity', 'weekly', 'monthly'], default: 'activity', index: true },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    // Class at the time of the record, so history stays correct if the student moves class.
    className: { type: String, trim: true, default: '' },
    date: { type: Date, default: Date.now },
    milestone: { type: String, trim: true },
    activity: { type: String, trim: true },
    observations: { type: String, trim: true, default: '' },
    assessment: { type: String, trim: true },
    notes: { type: String, trim: true },
    learningArea: { type: String, trim: true, default: '' },
    evaluation: { type: String, trim: true, default: '' },
    strengths: { type: String, trim: true, default: '' },
    areasForImprovement: { type: String, trim: true, default: '' },
    overallDevelopment: { type: String, trim: true, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

academicProgressSchema.index({ student: 1, entryType: 1, periodStart: 1 });

module.exports = mongoose.model('AcademicProgress', academicProgressSchema);
