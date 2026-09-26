const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const logActivity = require('../utils/logActivity');

// POST /api/attendance   (teacher marks/updates attendance for a student+date)
exports.markAttendance = async (req, res) => {
  try {
    const { student, date, status, remarks } = req.body;
    const record = await Attendance.findOneAndUpdate(
      { student, date: new Date(date) },
      { student, date: new Date(date), status, remarks, markedBy: req.user._id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await logActivity(req.user._id, 'attendance-marked', `${student} -> ${status}`);
    res.status(201).json({ attendance: record });
  } catch (err) {
    res.status(500).json({ message: 'Could not save attendance.', error: err.message });
  }
};

// GET /api/attendance/student/:studentId
exports.getStudentAttendance = async (req, res) => {
  // Parents may only see their own child's records
  if (req.user.role === 'parent') {
    const student = await Student.findOne({ _id: req.params.studentId, parent: req.user._id });
    if (!student) return res.status(403).json({ message: 'Not authorized to view this record.' });
  }
  const records = await Attendance.find({ student: req.params.studentId }).sort({ date: -1 });
  res.json({ attendance: records });
};

// GET /api/attendance/class?date=YYYY-MM-DD   (teacher: today's roster for their students)
exports.getClassAttendance = async (req, res) => {
  const students = await Student.find({ teacher: req.user._id, status: 'active' });
  const date = req.query.date ? new Date(req.query.date) : new Date();
  date.setHours(0, 0, 0, 0);
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);

  const records = await Attendance.find({
    student: { $in: students.map((s) => s._id) },
    date: { $gte: date, $lt: nextDay },
  });
  const byStudent = Object.fromEntries(records.map((r) => [r.student.toString(), r]));

  res.json({
    date,
    roster: students.map((s) => ({
      student: { id: s._id, name: s.name, className: s.className },
      attendance: byStudent[s._id.toString()] || null,
    })),
  });
};
