const mongoose = require('mongoose');

const academicProgressSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, default: Date.now },
    milestone: { type: String, trim: true },
    activity: { type: String, trim: true },
    assessment: { type: String, trim: true },
    notes: { type: String, trim: true },
    learningArea: { type: String, trim: true, default: '' },
    evaluation: { type: String, trim: true, default: '' },
    strengths: { type: String, trim: true, default: '' },
    areasForImprovement: { type: String, trim: true, default: '' },
    overallDevelopment: { type: String, trim: true, default: '' },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AcademicProgress', academicProgressSchema);
