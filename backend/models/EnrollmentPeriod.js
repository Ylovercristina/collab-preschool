const mongoose = require('mongoose');

const enrollmentPeriodSchema = new mongoose.Schema(
  {
    term: { type: String, required: true, trim: true, maxlength: 80 },
    schoolYear: { type: String, required: true, trim: true, maxlength: 40 },
    opensAt: { type: Date, required: true },
    closesAt: { type: Date, required: true },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EnrollmentPeriod', enrollmentPeriodSchema);
