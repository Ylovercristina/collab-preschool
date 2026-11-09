const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    firstName: { type: String, trim: true, default: '' },
    middleName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: {
      type: String,
      required: function () { return !this.googleId; },
      minlength: 6,
      select: false,
    },
    googleId: { type: String, unique: true, sparse: true, default: undefined },
    avatar: { type: String, default: null },
    address: { type: String, trim: true, default: '' },
    childrenNames: { type: [String], default: [] },
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date, default: null },
    emailVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    role: { type: String, enum: ['admin', 'teacher', 'parent'], required: true },
    phone: { type: String, trim: true },
    employeeId: { type: String, unique: true, sparse: true },
    assignedClass: { type: String, trim: true, default: '' },
    employmentStartDate: { type: Date },
    employmentType: { type: String, trim: true, default: '' },
    documents: { type: [documentSchema], default: [], select: false },

    // Admins are auto-approved. Teachers are created by an admin (auto-approved).
    // Parents self-signup and need admin approval before they can log in.
    status: {
      type: String,
      enum: ['pending', 'approved', 'archived'],
      default: function () {
        return this.role === 'parent' ? 'pending' : 'approved';
      },
    },

    passwordResetOtpHash: { type: String, select: false },
    passwordResetOtpExpires: { type: Date, select: false },
    passwordResetOtpAttempts: { type: Number, default: 0, select: false },
    passwordResetOtpSentAt: { type: Date, select: false },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    integrationOtpHash: { type: String, select: false },
    integrationOtpExpires: { type: Date, select: false },
    integrationOtpAttempts: { type: Number, default: 0, select: false },
    integrationOtpSentAt: { type: Date, select: false },
    integrationOtpPurpose: { type: String, enum: ['access', 'save'], select: false },
    integrationOtpLockedUntil: { type: Date, select: false },
    integrationPinChallengeHash: { type: String, select: false },
    integrationPinChallengeExpires: { type: Date, select: false },
    integrationPinAttempts: { type: Number, default: 0, select: false },
    integrationPinLockedUntil: { type: Date, select: false },
    integrationSaveGrantHash: { type: String, select: false },
    integrationSaveGrantExpires: { type: Date, select: false },
    googleLoginCodeHash: { type: String, select: false },
    googleLoginCodeExpires: { type: Date, select: false },
    googleLoginMode: { type: String, enum: ['login', 'signup'], select: false },
    googleLoginCaptchaVerified: { type: Boolean, select: false, default: false },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
