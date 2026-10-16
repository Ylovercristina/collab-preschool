const mongoose = require('mongoose');
const crypto = require('crypto');

const documentSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true, trim: true },
    filename: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const studentSchema = new mongoose.Schema(
  {
    studentId: { type: String, unique: true, sparse: true, default: () => `STU-${crypto.randomBytes(4).toString('hex').toUpperCase()}` },
    name: { type: String, required: true, trim: true },
    birthdate: { type: Date },
    className: { type: String, trim: true, default: 'Unassigned' },
    enrollmentDate: { type: Date, default: Date.now },
    guardianName: { type: String, trim: true, default: '' },
    guardianPhone: { type: String, trim: true, default: '' },
    documents: { type: [documentSchema], default: [], select: false },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    enrollmentApplication: { type: mongoose.Schema.Types.ObjectId, ref: 'EnrollmentApplication' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

studentSchema.index({ enrollmentApplication: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Student', studentSchema);
