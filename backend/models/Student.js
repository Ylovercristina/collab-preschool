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

const photoSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const studentSchema = new mongoose.Schema(
  {
    photo: { type: photoSchema, default: undefined },
    studentId: { type: String, unique: true, sparse: true, default: () => `STU-${crypto.randomBytes(4).toString('hex').toUpperCase()}` },
    name: { type: String, required: true, trim: true, maxlength: [120, 'Student name must be 120 characters or fewer.'] },
    birthdate: {
      type: Date,
      validate: {
        validator: (value) => !value || value <= new Date(),
        message: 'Birthdate cannot be in the future.',
      },
    },
    className: { type: String, trim: true, default: 'Unassigned' },
    enrollmentDate: { type: Date, default: Date.now },
    guardianName: { type: String, trim: true, default: '' },
    guardianPhone: { type: String, trim: true, default: '' },
    documents: { type: [documentSchema], default: [], select: false },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    enrollmentApplication: { type: mongoose.Schema.Types.ObjectId, ref: 'EnrollmentApplication' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    // Archived students are permanently deleted 30 days after archivedAt unless restored.
    archivedAt: { type: Date, default: null, index: true },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

// Any save that archives or restores a student (e.g. the Edit Student status field) keeps archivedAt in step.
studentSchema.pre('save', function syncArchivedAt(next) {
  if (this.isModified('status')) {
    if (this.status === 'archived' && !this.archivedAt) this.archivedAt = new Date();
    if (this.status === 'active') {
      this.archivedAt = null;
      this.archivedBy = null;
    }
  }
  next();
});

studentSchema.index({ enrollmentApplication: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Student', studentSchema);
module.exports.photoSchema = photoSchema;
