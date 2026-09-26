const AcademicProgress = require('../models/AcademicProgress');
const Student = require('../models/Student');
const logActivity = require('../utils/logActivity');

// POST /api/progress   (teacher logs a milestone/activity/assessment)
exports.addProgress = async (req, res) => {
  try {
    const { student, milestone, activity, assessment, notes, date } = req.body;
    const entry = await AcademicProgress.create({
      student, teacher: req.user._id, milestone, activity, assessment, notes,
      date: date ? new Date(date) : undefined,
    });
    await logActivity(req.user._id, 'progress-added', `student ${student}`);
    res.status(201).json({ progress: entry });
  } catch (err) {
    res.status(500).json({ message: 'Could not save progress entry.', error: err.message });
  }
};

// GET /api/progress/student/:studentId
exports.getStudentProgress = async (req, res) => {
  if (req.user.role === 'parent') {
    const student = await Student.findOne({ _id: req.params.studentId, parent: req.user._id });
    if (!student) return res.status(403).json({ message: 'Not authorized to view this record.' });
  }
  const entries = await AcademicProgress.find({ student: req.params.studentId })
    .populate('teacher', 'name')
    .sort({ date: -1 });
  res.json({ progress: entries });
};

// PATCH /api/progress/:id
exports.updateProgress = async (req, res) => {
  const allowed = ['milestone', 'activity', 'assessment', 'notes'];
  const update = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  const entry = await AcademicProgress.findOneAndUpdate(
    { _id: req.params.id, teacher: req.user._id },
    update,
    { new: true }
  );
  if (!entry) return res.status(404).json({ message: 'Entry not found.' });
  res.json({ progress: entry });
};
