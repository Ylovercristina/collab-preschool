const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
    role: { type: String, enum: ['admin', 'teacher', 'parent'], required: true },
    phone: { type: String, trim: true },

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
    googleLoginCodeHash: { type: String, select: false },
    googleLoginCodeExpires: { type: Date, select: false },
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
