const mongoose = require('mongoose');

// A class or section. Students and teachers keep referring to it by name
// (Student.className, User.assignedClass), so existing records keep working.
const classroomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Lower-cased name; prevents "K1-A" and "k1-a" from becoming two classes.
    nameKey: { type: String, required: true, unique: true },
    description: { type: String, trim: true, default: '', maxlength: 500 },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

classroomSchema.pre('validate', function setNameKey(next) {
  this.nameKey = String(this.name || '').trim().toLowerCase();
  next();
});

module.exports = mongoose.model('Classroom', classroomSchema);
