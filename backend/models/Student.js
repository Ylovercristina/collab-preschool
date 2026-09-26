const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    birthdate: { type: Date },
    className: { type: String, trim: true, default: 'Unassigned' },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Student', studentSchema);
