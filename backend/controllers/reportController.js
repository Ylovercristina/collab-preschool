const Student = require('../models/Student');
const Fee = require('../models/Fee');
const Attendance = require('../models/Attendance');

// GET /api/reports/students   (admin: roster summary)
exports.studentReport = async (req, res) => {
  const total = await Student.countDocuments();
  const active = await Student.countDocuments({ status: 'active' });
  const archived = await Student.countDocuments({ status: 'archived' });
  const byClass = await Student.aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: '$className', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  res.json({ total, active, archived, byClass });
};

// GET /api/reports/fees   (admin: collections summary)
exports.feeReport = async (req, res) => {
  const fees = await Fee.find();
  const totalBilled = fees.reduce((sum, f) => sum + f.amount, 0);
  const totalCollected = fees.reduce((sum, f) => sum + f.amountPaid, 0);
  const outstanding = totalBilled - totalCollected;
  const byStatus = fees.reduce((acc, f) => {
    acc[f.status] = (acc[f.status] || 0) + 1;
    return acc;
  }, {});
  res.json({ totalBilled, totalCollected, outstanding, byStatus, count: fees.length });
};

// GET /api/reports/attendance   (admin: quick attendance snapshot)
exports.attendanceReport = async (req, res) => {
  const byStatus = await Attendance.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  res.json({ byStatus });
};
