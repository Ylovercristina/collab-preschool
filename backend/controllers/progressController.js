const AcademicProgress = require('../models/AcademicProgress');
const Student = require('../models/Student');
const logActivity = require('../utils/logActivity');

// POST /api/progress   (teacher logs a milestone/activity/assessment)
exports.addProgress = async (req, res) => {
  try {
    const { student, milestone, activity, assessment, notes, date, learningArea, evaluation, strengths, areasForImprovement, overallDevelopment } = req.body;
    const assignedStudent = await Student.findOne({ _id: student, teacher: req.user._id });
    if (!assignedStudent) return res.status(403).json({ message: 'You can only record progress for students assigned to you.' });
    const entry = await AcademicProgress.create({
      student: assignedStudent._id, teacher: req.user._id, milestone, activity, assessment, notes,
      learningArea, evaluation, strengths, areasForImprovement, overallDevelopment,
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
  if (req.user.role === 'parent' || req.user.role === 'teacher') {
    const ownership = req.user.role === 'parent' ? { parent: req.user._id } : { teacher: req.user._id };
    const student = await Student.findOne({ _id: req.params.studentId, ...ownership });
    if (!student) return res.status(403).json({ message: 'Not authorized to view this record.' });
  }
  const entries = await AcademicProgress.find({ student: req.params.studentId })
    .populate('teacher', 'name')
    .sort({ date: -1 });
  res.json({ progress: entries });
};

// PATCH /api/progress/:id
exports.updateProgress = async (req, res) => {
  const allowed = ['milestone', 'activity', 'assessment', 'notes', 'learningArea', 'evaluation', 'strengths', 'areasForImprovement', 'overallDevelopment', 'date'];
  const update = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  const existingEntry = await AcademicProgress.findOne({ _id: req.params.id, teacher: req.user._id });
  if (!existingEntry) return res.status(404).json({ message: 'Entry not found.' });
  const assignedStudent = await Student.exists({ _id: existingEntry.student, teacher: req.user._id });
  if (!assignedStudent) return res.status(403).json({ message: 'You can only update progress for students assigned to you.' });
  const entry = await AcademicProgress.findOneAndUpdate({ _id: existingEntry._id, teacher: req.user._id }, update, { new: true, runValidators: true });
  if (!entry) return res.status(404).json({ message: 'Entry not found.' });
  res.json({ progress: entry });
};

// GET /api/progress (admin review)
exports.listAllProgress = async (req, res) => {
  const entries = await AcademicProgress.find()
    .populate('student', 'studentId name className')
    .populate('teacher', 'name')
    .populate('reviewedBy', 'name')
    .sort({ date: -1 });
  res.json({ progress: entries });
};

// PATCH /api/progress/:id/review
exports.reviewProgress = async (req, res) => {
  const entry = await AcademicProgress.findByIdAndUpdate(
    req.params.id,
    { reviewedAt: new Date(), reviewedBy: req.user._id },
    { new: true }
  ).populate('student', 'studentId name className')
    .populate('teacher', 'name')
    .populate('reviewedBy', 'name');
  if (!entry) return res.status(404).json({ message: 'Progress entry not found.' });
  res.json({ progress: entry });
};
