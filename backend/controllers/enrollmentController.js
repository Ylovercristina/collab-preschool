const EnrollmentPeriod = require('../models/EnrollmentPeriod');
const EnrollmentApplication = require('../models/EnrollmentApplication');
const Student = require('../models/Student');
const logActivity = require('../utils/logActivity');
const { resolveClassAssignment } = require('../utils/classAssignment');
const crypto = require('crypto');

function normalizeStudentName(studentName) {
  return studentName.trim().replace(/\s+/g, ' ').toLowerCase();
}

function studentIdentityKey(studentName, birthdate) {
  const normalizedName = normalizeStudentName(studentName);
  const date = birthdate.toISOString().slice(0, 10);
  return crypto.createHash('sha256').update(`${date}:${normalizedName}`).digest('hex');
}

function periodIsOpen(period, now = new Date()) {
  return Boolean(period && period.startedAt && period.enabled && period.opensAt <= now && period.closesAt >= now);
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

  const existingPeriod = await EnrollmentPeriod.findOne().sort({ updatedAt: -1 });
  const configurationChanged = existingPeriod && (
    existingPeriod.term !== term.trim()
    || existingPeriod.schoolYear !== schoolYear.trim()
    || existingPeriod.opensAt.getTime() !== openDate.getTime()
    || existingPeriod.closesAt.getTime() !== closeDate.getTime()
  );
  const update = {
    $set: { term: term.trim(), schoolYear: schoolYear.trim(), opensAt: openDate, closesAt: closeDate, enabled },
  };
  if (configurationChanged && existingPeriod.startedAt) update.$unset = { startedAt: 1 };

  const period = await EnrollmentPeriod.findOneAndUpdate(
    existingPeriod ? { _id: existingPeriod._id } : {},
    update,
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  await logActivity(req.user._id, 'enrollment-period-updated', `${period.term} ${period.schoolYear}`);
  res.json({ period, available: periodIsOpen(period) });
};

exports.startPeriod = async (req, res) => {
  const period = await EnrollmentPeriod.findOne().sort({ updatedAt: -1 });
  if (!period) return res.status(404).json({ message: 'Save an enrollment period before starting enrollment.' });
  if (!period.enabled) return res.status(400).json({ message: 'Enable applications before starting enrollment.' });
  if (period.closesAt < new Date()) {
    return res.status(400).json({ message: 'The saved enrollment period has ended. Update its dates before starting enrollment.' });
  }

  if (!period.startedAt) {
    period.startedAt = new Date();
    await period.save();
    await logActivity(req.user._id, 'enrollment-period-started', `${period.term} ${period.schoolYear}`);
  }

  res.json({ period, available: periodIsOpen(period) });
};

exports.listApplications = async (req, res) => {
  const applications = await EnrollmentApplication.find()
    .populate('parent', 'name email phone')
    .populate('applicant', 'name email role')
    .populate('period', 'term schoolYear')
    .populate('student', 'studentId name className enrollmentDate')
    .sort({ createdAt: -1 });
  res.json({ applications });
};

exports.submitApplication = async (req, res) => {
  const period = await EnrollmentPeriod.findOne().sort({ updatedAt: -1 });
  if (!periodIsOpen(period)) {
    return res.status(403).json({ message: 'Enrollment is not currently open for a term.' });
  }

  const studentName = typeof req.body.studentName === 'string'
    ? req.body.studentName.trim().replace(/\s+/g, ' ')
    : '';
  const guardianName = req.user.role === 'parent'
    ? req.user.name
    : (typeof req.body.guardianName === 'string' ? req.body.guardianName.trim() : '');
  const birthdate = new Date(req.body.birthdate);
  if (!studentName || studentName.length > 120 || !guardianName || guardianName.length > 120
    || !req.body.birthdate || Number.isNaN(birthdate.getTime())
    || birthdate >= new Date()) {
    return res.status(400).json({ message: 'Enter the student’s full name, guardian name, and a valid birthdate.' });
  }

  const identityKey = studentIdentityKey(studentName, birthdate);
  try {
    const [existingApplications, existingStudents] = await Promise.all([
      EnrollmentApplication.find({
        $or: [
          { identityKey },
          { identityKey: { $exists: false }, birthdate, status: { $in: ['pending', 'approving', 'approved'] } },
        ],
      }).select('+identityKey studentName status'),
      Student.find({ birthdate }).select('name'),
    ]);
    const normalizedName = normalizeStudentName(studentName);
    const applicationExists = existingApplications.some((application) => (
      application.identityKey === identityKey
      || normalizeStudentName(application.studentName) === normalizedName
    ));
    const studentExists = existingStudents.some((student) => (
      normalizeStudentName(student.name) === normalizedName
    ));
    if (applicationExists || studentExists) {
      return res.status(409).json({ message: 'An enrollment application or student record already exists for this student.' });
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
      identityKey,
      guardianName,
      requestedClass: typeof req.body.requestedClass === 'string' ? req.body.requestedClass.trim().slice(0, 80) : '',
      guardianPhone: typeof req.body.guardianPhone === 'string' ? req.body.guardianPhone.trim().slice(0, 30) : '',
      notes: typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 1000) : '',
    });
    await logActivity(req.user._id, 'enrollment-application-submitted', studentName);
    return res.status(201).json({ application });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'An enrollment application or student record already exists for this student.' });
    }
    console.error('Could not submit enrollment application:', err);
    return res.status(500).json({ message: 'Could not submit enrollment application.' });
  }
};

exports.reviewApplication = async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Application status must be approved or rejected.' });
  }

  try {
    if (status === 'rejected') {
      const application = await EnrollmentApplication.findOneAndUpdate(
        { _id: req.params.id, status: 'pending' },
        {
          $set: { status: 'rejected', reviewedBy: req.user._id, reviewedAt: new Date() },
          $unset: { identityKey: 1 },
        },
        { new: true }
      );
      if (!application) return res.status(404).json({ message: 'Pending enrollment application not found.' });
      await logActivity(req.user._id, 'enrollment-application-rejected', application.studentName);
      return res.json({ application });
    }

    let application = await EnrollmentApplication.findOne({ _id: req.params.id, status: 'pending' })
      .populate('parent', 'name email phone');
    if (application) {
      const existingStudents = await Student.find({
        birthdate: application.birthdate,
        enrollmentApplication: { $ne: application._id },
      }).select('name');
      if (existingStudents.some((student) => (
        normalizeStudentName(student.name) === normalizeStudentName(application.studentName)
      ))) {
        return res.status(409).json({ message: 'A student record already exists for this student. Review the existing student record before approving.' });
      }

      application = await EnrollmentApplication.findOneAndUpdate(
        { _id: application._id, status: 'pending' },
        { $set: { status: 'approving', reviewedBy: req.user._id, reviewedAt: new Date() } },
        { new: true }
      ).populate('parent', 'name email phone');
    } else {
      application = await EnrollmentApplication.findOne({ _id: req.params.id, status: 'approving' })
        .populate('parent', 'name email phone');
    }
    if (!application) return res.status(404).json({ message: 'Pending enrollment application not found.' });

    let student = await Student.findOne({ enrollmentApplication: application._id });
    if (!student) {
      const studentData = {
        name: application.studentName,
        birthdate: application.birthdate,
        className: application.requestedClass || 'Unassigned',
        enrollmentDate: new Date(),
        guardianName: application.guardianName || application.parent?.name || '',
        guardianPhone: application.guardianPhone || application.parent?.phone || '',
        parent: application.parent?._id,
        teacher: application.teacher,
        enrollmentApplication: application._id,
      };
      // A requested class that is set up under Classes brings its teacher.
      const resolvedClass = await resolveClassAssignment(studentData.className);
      if (!resolvedClass.error) {
        studentData.className = resolvedClass.className;
        if (resolvedClass.teacher) studentData.teacher = resolvedClass.teacher;
      }
      try {
        student = await Student.findOneAndUpdate(
          { enrollmentApplication: application._id },
          { $setOnInsert: studentData },
          { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );
      } catch (err) {
        if (err.code !== 11000) throw err;
        student = await Student.findOne({ enrollmentApplication: application._id });
        if (!student) throw err;
      }
    }

    const approvedApplication = await EnrollmentApplication.findOneAndUpdate(
      { _id: application._id, status: 'approving' },
      { $set: { status: 'approved', student: student._id } },
      { new: true }
    );
    if (approvedApplication) {
      await logActivity(req.user._id, 'enrollment-application-approved', application.studentName);
      return res.json({ application: approvedApplication });
    }

    const completedApplication = await EnrollmentApplication.findById(application._id);
    if (completedApplication?.status === 'approved') return res.json({ application: completedApplication });
    return res.status(409).json({ message: 'This enrollment application changed while it was being reviewed. Refresh and try again.' });
  } catch (err) {
    console.error(`Could not ${status} enrollment application:`, err);
    return res.status(500).json({ message: `Could not ${status} enrollment application.` });
  }
};
