const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const mongoose = require('mongoose');
const logActivity = require('../utils/logActivity');

// POST /api/attendance   (teacher marks/updates attendance for a student+date)
exports.markAttendance = async (req, res) => {
  try {
    const { student: studentId, date: dateValue, status, remarks } = req.body;
    if (!mongoose.isObjectIdOrHexString(studentId)) {
      return res.status(400).json({ message: 'Choose a valid student.' });
    }
    if (typeof dateValue !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      return res.status(400).json({ message: 'Choose a valid attendance date.' });
    }
    const date = new Date(`${dateValue}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateValue) {
      return res.status(400).json({ message: 'Choose a valid attendance date.' });
    }
    if (!['present', 'absent', 'late', 'tardy', 'excused'].includes(status)) {
      return res.status(400).json({ message: 'Choose a valid attendance status.' });
    }
    if (remarks !== undefined && (typeof remarks !== 'string' || remarks.length > 500)) {
      return res.status(400).json({ message: 'Attendance remarks must be 500 characters or fewer.' });
    }
    const assignedStudent = await Student.findOne({
      _id: studentId,
      teacher: req.user._id,
      status: 'active',
    });
    if (!assignedStudent) return res.status(404).json({ message: 'Assigned active student not found.' });

    const record = await Attendance.findOneAndUpdate(
      { student: assignedStudent._id, date },
      { student: assignedStudent._id, date, status, remarks, markedBy: req.user._id },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    await logActivity(req.user._id, 'attendance-marked', `${assignedStudent.name} -> ${status}`);
    res.status(201).json({ attendance: record });
  } catch (err) {
    const statusCode = err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500;
    res.status(statusCode).json({ message: statusCode === 400 ? err.message : 'Could not save attendance.', error: err.message });
  }
};

// GET /api/attendance/student/:studentId
exports.getStudentAttendance = async (req, res) => {
  if (req.user.role === 'teacher') {
    const student = await Student.findOne({ _id: req.params.studentId, teacher: req.user._id });
    if (!student) return res.status(403).json({ message: 'Not authorized to view this record.' });
  }
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
  if (req.query.date && !/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
    return res.status(400).json({ message: 'Choose a valid attendance date.' });
  }
  const date = req.query.date ? new Date(`${req.query.date}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(date.getTime())
      || (req.query.date && date.toISOString().slice(0, 10) !== req.query.date)) {
    return res.status(400).json({ message: 'Choose a valid attendance date.' });
  }
  if (req.query.date) date.setUTCHours(0, 0, 0, 0);
  else date.setHours(0, 0, 0, 0);
  const nextDay = new Date(date);
  if (req.query.date) nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  else nextDay.setDate(nextDay.getDate() + 1);

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
