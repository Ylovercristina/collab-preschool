const EnrollmentPeriod = require('../models/EnrollmentPeriod');
const EnrollmentApplication = require('../models/EnrollmentApplication');
const Student = require('../models/Student');
const logActivity = require('../utils/logActivity');

function periodIsOpen(period, now = new Date()) {
  return Boolean(period && period.enabled && period.opensAt <= now && period.closesAt >= now);
}

exports.getAvailability = async (req, res) => {
  const period = await EnrollmentPeriod.findOne().sort({ updatedAt: -1 });
  const result = {
    available: periodIsOpen(period),
    period: period || null,
  };
  if (['parent', 'teacher'].includes(req.user.role)) {
    result.applications = await EnrollmentApplication.find({ applicant: req.user._id })
      .sort({ createdAt: -1 });
  }
  res.json(result);
};

exports.updatePeriod = async (req, res) => {
  const { term, schoolYear, opensAt, closesAt, enabled } = req.body;
  const openDate = new Date(`${opensAt}T00:00:00`);
  const closeDate = new Date(`${closesAt}T23:59:59.999`);
  const matchesDate = (value, date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === value;
  if (!term?.trim() || !schoolYear?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(opensAt || '')
    || !/^\d{4}-\d{2}-\d{2}$/.test(closesAt || '')
    || Number.isNaN(openDate.getTime()) || Number.isNaN(closeDate.getTime())
    || !matchesDate(opensAt, openDate) || !matchesDate(closesAt, closeDate) || closeDate <= openDate
    || typeof enabled !== 'boolean') {
    return res.status(400).json({ message: 'Provide a term, school year, valid opening and closing dates, and enrollment status.' });
  }

  const period = await EnrollmentPeriod.findOneAndUpdate(
    {},
    { term: term.trim(), schoolYear: schoolYear.trim(), opensAt: openDate, closesAt: closeDate, enabled },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  await logActivity(req.user._id, 'enrollment-period-updated', `${period.term} ${period.schoolYear}`);
  res.json({ period, available: periodIsOpen(period) });
};

exports.listApplications = async (req, res) => {
  const applications = await EnrollmentApplication.find()
    .populate('parent', 'name email phone')
    .populate('applicant', 'name email role')
    .populate('period', 'term schoolYear')
    .populate('student', 'studentId name')
    .sort({ createdAt: -1 });
  res.json({ applications });
};

exports.submitApplication = async (req, res) => {
  const period = await EnrollmentPeriod.findOne().sort({ updatedAt: -1 });
  if (!periodIsOpen(period)) {
    return res.status(403).json({ message: 'Enrollment is not currently open for a term.' });
  }

  const studentName = typeof req.body.studentName === 'string' ? req.body.studentName.trim() : '';
  const guardianName = req.user.role === 'parent'
    ? req.user.name
    : (typeof req.body.guardianName === 'string' ? req.body.guardianName.trim() : '');
  const birthdate = new Date(req.body.birthdate);
  if (!studentName || studentName.length > 120 || !guardianName || guardianName.length > 120
    || !req.body.birthdate || Number.isNaN(birthdate.getTime())
    || birthdate >= new Date()) {
    return res.status(400).json({ message: 'Enter the student’s full name, guardian name, and a valid birthdate.' });
  }

  const application = await EnrollmentApplication.create({
    applicant: req.user._id,
    submittedRole: req.user.role,
    parent: req.user.role === 'parent' ? req.user._id : undefined,
    teacher: req.user.role === 'teacher' ? req.user._id : undefined,
    period: period._id,
    term: period.term,
    schoolYear: period.schoolYear,
    studentName,
    birthdate,
    guardianName,
    requestedClass: typeof req.body.requestedClass === 'string' ? req.body.requestedClass.trim().slice(0, 80) : '',
    guardianPhone: typeof req.body.guardianPhone === 'string' ? req.body.guardianPhone.trim().slice(0, 30) : '',
    notes: typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 1000) : '',
  });
  await logActivity(req.user._id, 'enrollment-application-submitted', studentName);
  res.status(201).json({ application });
};

exports.reviewApplication = async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Application status must be approved or rejected.' });
  }

  const application = await EnrollmentApplication.findOne({ _id: req.params.id, status: 'pending' })
    .populate('parent', 'name email phone');
  if (!application) return res.status(404).json({ message: 'Pending enrollment application not found.' });

  if (status === 'approved') {
    const student = await Student.create({
      name: application.studentName,
      birthdate: application.birthdate,
      className: application.requestedClass || 'Unassigned',
      enrollmentDate: new Date(),
      guardianName: application.guardianName || application.parent?.name || '',
      guardianPhone: application.guardianPhone || application.parent?.phone || '',
      parent: application.parent?._id,
      teacher: application.teacher,
    });
    application.student = student._id;
  }

  application.status = status;
  application.reviewedBy = req.user._id;
  application.reviewedAt = new Date();
  await application.save();
  await logActivity(req.user._id, `enrollment-application-${status}`, application.studentName);
  res.json({ application });
};
