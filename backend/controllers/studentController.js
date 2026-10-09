const Student = require('../models/Student');
const logActivity = require('../utils/logActivity');

// Helper: build a scope filter based on who's asking
function scopeFilter(user, req) {
  if (user.role === 'admin') return {};
  if (user.role === 'teacher') {
    if (req && req.query && req.query.myClass === 'true') {
      return { teacher: user._id };
    }
    return {};
  }
  if (user.role === 'parent') return { parent: user._id };
  return { _id: null };
}

// GET /api/students
exports.listStudents = async (req, res) => {
  const filter = { ...scopeFilter(req.user, req) };
  if (req.query.status) filter.status = req.query.status;
  const students = await Student.find(filter)
    .populate('parent', 'name email phone')
    .populate('teacher', 'name email')
    .sort({ name: 1 });
  res.json({ students });
};

// GET /api/students/:id
exports.getStudent = async (req, res) => {
  const student = await Student.findOne({ _id: req.params.id, ...scopeFilter(req.user, req) })
    .populate('parent', 'name email phone')
    .populate('teacher', 'name email');
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  res.json({ student });
};

// POST /api/students   (admin, or teacher during admission review)
exports.createStudent = async (req, res) => {
  try {
    const { name, birthdate, className, parent, teacher, notes } = req.body;
    const student = await Student.create({ name, birthdate, className, parent, teacher, notes });
    await logActivity(req.user._id, 'student-created', name);
    const populated = await Student.findById(student._id)
      .populate('parent', 'name email phone')
      .populate('teacher', 'name email');
    res.status(201).json({ student: populated });
  } catch (err) {
    res.status(500).json({ message: 'Could not add student.', error: err.message });
  }
};

// PATCH /api/students/:id
exports.updateStudent = async (req, res) => {
  try {
    const allowed = ['name', 'birthdate', 'className', 'parent', 'teacher', 'notes', 'status'];
    const update = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) update[k] = req.body[k]; });

    const student = await Student.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('parent', 'name email phone')
      .populate('teacher', 'name email');
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    await logActivity(req.user._id, 'student-updated', student.name);
    res.json({ student });
  } catch (err) {
    res.status(500).json({ message: 'Could not update student.', error: err.message });
  }
};

// PATCH /api/students/:id/archive
exports.archiveStudent = async (req, res) => {
  const student = await Student.findByIdAndUpdate(req.params.id, { status: 'archived' }, { new: true });
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  await logActivity(req.user._id, 'student-archived', student.name);
  res.json({ student });
};
