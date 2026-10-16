const mongoose = require('mongoose');

const enrollmentApplicationSchema = new mongoose.Schema(
  {
    applicant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    submittedRole: { type: String, enum: ['parent', 'teacher'], required: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    period: { type: mongoose.Schema.Types.ObjectId, ref: 'EnrollmentPeriod', required: true },
    term: { type: String, required: true, trim: true, maxlength: 80 },
    schoolYear: { type: String, required: true, trim: true, maxlength: 40 },
    studentName: { type: String, required: true, trim: true, maxlength: 120 },
    birthdate: { type: Date, required: true },
    identityKey: { type: String, select: false },
    guardianName: { type: String, trim: true, maxlength: 120, default: '' },
    requestedClass: { type: String, trim: true, maxlength: 80, default: '' },
    guardianPhone: { type: String, trim: true, maxlength: 30, default: '' },
    notes: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: ['pending', 'approving', 'approved', 'rejected'], default: 'pending' },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

enrollmentApplicationSchema.index({ applicant: 1, period: 1, studentName: 1 });
enrollmentApplicationSchema.index({ identityKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('EnrollmentApplication', enrollmentApplicationSchema);
