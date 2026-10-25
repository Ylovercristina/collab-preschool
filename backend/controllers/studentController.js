const Student = require('../models/Student');
const logActivity = require('../utils/logActivity');
const { applyClassToStudentData } = require('../utils/classAssignment');
const mongoose = require('mongoose');

// Helper: build a scope filter based on who's asking
function scopeFilter(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'teacher') return { teacher: user._id };
  if (user.role === 'parent') return { parent: user._id };
  return { _id: null };
}

// GET /api/students
exports.listStudents = async (req, res) => {
  const filter = { ...scopeFilter(req.user) };
  if (req.query.status) filter.status = req.query.status;
  const students = await Student.find(filter)
    .populate('parent', 'name email phone status emailVerified emailVerifiedBy')
    .populate('teacher', 'name email')
    .sort({ name: 1 });
  res.json({ students });
};

// GET /api/students/:id
exports.getStudent = async (req, res) => {
  const student = await Student.findOne({ _id: req.params.id, ...scopeFilter(req.user) })
    .populate('parent', 'name email phone status emailVerified emailVerifiedBy')
    .populate('teacher', 'name email');
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  res.json({ student });
};

// POST /api/students   (admin)
exports.createStudent = async (req, res) => {
  try {
    const { name, birthdate, className, parent, teacher, notes } = req.body;
    const data = { name, birthdate, className, parent, teacher, notes };
    const classError = await applyClassToStudentData(data);
    if (classError) return res.status(400).json({ message: classError });
    const student = await Student.create(data);
    await logActivity(req.user._id, 'student-created', name);
    const populated = await Student.findById(student._id)
      .populate('parent', 'name email phone status emailVerified emailVerifiedBy')
      .populate('teacher', 'name email');
    res.status(201).json({ student: populated });
  } catch (err) {
    res.status(500).json({ message: 'Could not add student.', error: err.message });
  }
};

// PATCH /api/students/:id
exports.updateStudent = async (req, res) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      return res.status(404).json({ message: 'Student not found.' });
    }
    const allowed = req.user.role === 'teacher'
      ? ['name', 'birthdate', 'className', 'enrollmentDate', 'guardianName', 'guardianPhone', 'notes']
      : ['name', 'birthdate', 'className', 'enrollmentDate', 'guardianName', 'guardianPhone', 'parent', 'teacher', 'notes', 'status'];
    if (req.user.role === 'teacher' && Object.keys(req.body || {}).some((key) => !allowed.includes(key))) {
      return res.status(403).json({ message: 'Teachers may only update assigned student and enrollment information.' });
    }
    const update = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    if (!Object.keys(update).length) {
      return res.status(400).json({ message: 'Provide at least one student field to update.' });
    }

    const filter = { _id: req.params.id };
    if (req.user.role === 'teacher') filter.teacher = req.user._id;
    const student = await Student.findOne(filter);
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    const classError = await applyClassToStudentData(update, student.className);
    if (classError) return res.status(400).json({ message: classError });
    // Teachers may not move a student out of their own care.
    if (req.user.role === 'teacher' && update.teacher !== undefined && String(update.teacher || '') !== String(req.user._id)) {
      return res.status(403).json({ message: 'You can only move students into a class you teach. Ask an admin to change their class.' });
    }
    student.set(update);
    await student.save();
    await student.populate('parent', 'name email phone status emailVerified emailVerifiedBy');
    await student.populate('teacher', 'name email');
    await logActivity(req.user._id, 'student-updated', student.name);
    res.json({ student });
  } catch (err) {
    const statusCode = err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500;
    res.status(statusCode).json({ message: statusCode === 400 ? err.message : 'Could not update student.', error: err.message });
  }
};

// PATCH /api/students/:id/archive
exports.archiveStudent = async (req, res) => {
  const student = await Student.findByIdAndUpdate(req.params.id, { status: 'archived' }, { new: true });
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  await logActivity(req.user._id, 'student-archived', student.name);
  res.json({ student });
};
