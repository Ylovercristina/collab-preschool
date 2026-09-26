const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
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

    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
