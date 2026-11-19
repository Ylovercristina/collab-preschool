const Student = require('../models/Student');
const { isOfficeRole } = require('../config/permissions');
const logActivity = require('../utils/logActivity');
const { applyClassToStudentData, archivedTeacherError } = require('../utils/classAssignment');
const { normalizeStudentNameField, syncStudentNameCopies } = require('../utils/studentName');
const { ARCHIVE_RETENTION_DAYS, deletionDate, permanentlyDeleteStudent } = require('../utils/accountPurge');
const mongoose = require('mongoose');
const { studentFieldError, findDuplicateStudent } = require('../utils/validation');
const { removeStudentPhotoFile, photoRecord, sendStudentPhoto } = require('../middleware/studentPhotoUpload');

// Helper: build a scope filter based on who's asking
function scopeFilter(user) {
  if (isOfficeRole(user.role)) return {};
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
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ message: 'Student not found.' });
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
    const data = { name: name ?? '', birthdate, className, parent, teacher, notes };
    const nameError = normalizeStudentNameField(data);
    if (nameError) return res.status(400).json({ message: nameError });
    const fieldError = studentFieldError(data);
    if (fieldError) return res.status(400).json({ message: fieldError });
    const archivedError = await archivedTeacherError(data.teacher);
    if (archivedError) return res.status(400).json({ message: archivedError });
    const classError = await applyClassToStudentData(data);
    if (classError) return res.status(400).json({ message: classError });
    const duplicate = await findDuplicateStudent(data);
    if (duplicate) {
      return res.status(409).json({ message: `A student record for ${duplicate.name} already exists. Edit that record instead.` });
    }
    const student = await Student.create(data);
    await logActivity(req.user._id, 'student-created', name);
    const populated = await Student.findById(student._id)
      .populate('parent', 'name email phone status emailVerified emailVerifiedBy')
      .populate('teacher', 'name email');
    res.status(201).json({ student: populated });
  } catch (err) {
    if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ message: err.message });
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
    const nameError = normalizeStudentNameField(update);
    if (nameError) return res.status(400).json({ message: nameError });

    const fieldError = studentFieldError(update);
    if (fieldError) return res.status(400).json({ message: fieldError });

    const filter = { _id: req.params.id };
    if (req.user.role === 'teacher') filter.teacher = req.user._id;
    const student = await Student.findOne(filter);
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    const archivedError = await archivedTeacherError(update.teacher, student.teacher);
    if (archivedError) return res.status(400).json({ message: archivedError });
    const classError = await applyClassToStudentData(update, student.className);
    if (classError) return res.status(400).json({ message: classError });
    if (update.name !== undefined || update.parent !== undefined || update.birthdate !== undefined) {
      const duplicate = await findDuplicateStudent({
        name: update.name ?? student.name,
        parent: update.parent !== undefined ? update.parent : student.parent,
        birthdate: update.birthdate !== undefined ? update.birthdate : student.birthdate,
        className: update.className ?? student.className,
      }, student._id);
      if (duplicate) {
        return res.status(409).json({ message: `Another student record for ${duplicate.name} already exists.` });
      }
    }
    // Teachers may not move a student out of their own care.
    if (req.user.role === 'teacher' && update.teacher !== undefined && String(update.teacher || '') !== String(req.user._id)) {
      return res.status(403).json({ message: 'You can only move students into a class you teach. Ask an admin to change their class.' });
    }
    const previousName = student.name;
    if (update.status === 'archived' && student.status !== 'archived') update.archivedBy = req.user._id;
    student.set(update);
    await student.save();
    await syncStudentNameCopies(student, previousName);
    await student.populate('parent', 'name email phone status emailVerified emailVerifiedBy');
    await student.populate('teacher', 'name email');
    await logActivity(req.user._id, 'student-updated', student.name);
    res.json({ student });
  } catch (err) {
    const statusCode = err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500;
    res.status(statusCode).json({ message: statusCode === 400 ? err.message : 'Could not update student.', error: err.message });
  }
};

// GET /api/students/:id/photo  (admin, assigned teacher, or the student's parent)
exports.getStudentPhoto = async (req, res) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ message: 'Photo not found.' });
    const student = await Student.findOne({ _id: req.params.id, ...scopeFilter(req.user) }).select('photo');
    if (!student || !student.photo) return res.status(404).json({ message: 'Photo not found.' });
    sendStudentPhoto(res, student.photo);
  } catch (err) {
    console.error('[students] Photo load failed:', err.message);
    res.status(500).json({ message: 'Could not load photo.' });
  }
};

// PUT /api/students/:id/photo  (admin, assigned teacher, or the student's parent)
exports.updateStudentPhoto = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Choose a photo of the student to upload.' });
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      await removeStudentPhotoFile(req.file.filename);
      return res.status(404).json({ message: 'Student not found.' });
    }
    const student = await Student.findOne({ _id: req.params.id, ...scopeFilter(req.user) });
    if (!student) {
      await removeStudentPhotoFile(req.file.filename);
      return res.status(404).json({ message: 'Student not found.' });
    }
    const previous = student.photo && student.photo.filename;
    student.photo = photoRecord(req.file);
    await student.save();
    if (previous) await removeStudentPhotoFile(previous);
    await student.populate('parent', 'name email phone status emailVerified emailVerifiedBy');
    await student.populate('teacher', 'name email');
    await logActivity(req.user._id, 'student-photo-updated', student.name);
    res.json({ student });
  } catch (err) {
    await removeStudentPhotoFile(req.file.filename);
    console.error('[students] Photo update failed:', err.message);
    res.status(500).json({ message: 'Could not save the student photo.' });
  }
};

// PATCH /api/students/:id/archive
exports.archiveStudent = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ message: 'Student not found.' });
  const student = await Student.findById(req.params.id);
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  if (student.status !== 'archived') {
    student.status = 'archived';
    student.archivedAt = new Date();
    student.archivedBy = req.user._id;
    await student.save();
    await logActivity(req.user._id, 'student-archived', student.name);
  }
  res.json({
    student,
    message: `Student archived. The record will be permanently deleted in ${ARCHIVE_RETENTION_DAYS} days unless restored from Settings → Archived accounts.`,
  });
};

// GET /api/students/archived  (admin: archived students and their deletion dates)
exports.listArchivedStudents = async (req, res) => {
  const students = await Student.find({ status: 'archived' })
    .populate('archivedBy', 'name')
    .populate('parent', 'name')
    .sort({ archivedAt: 1, updatedAt: 1 });
  const now = Date.now();
  res.json({
    students: students.map((student) => {
      const archivedAt = student.archivedAt || student.updatedAt;
      const deleteAfter = deletionDate(archivedAt);
      return {
        id: student._id,
        name: student.name,
        studentId: student.studentId,
        className: student.className,
        parentName: student.parent ? student.parent.name : '',
        archivedAt,
        archivedBy: student.archivedBy ? student.archivedBy.name : null,
        deleteAfter,
        daysLeft: Math.max(0, Math.ceil((deleteAfter.getTime() - now) / (24 * 60 * 60 * 1000))),
      };
    }),
  });
};

// PATCH /api/students/:id/restore  (admin)
exports.restoreStudent = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ message: 'Student not found.' });
  const student = await Student.findById(req.params.id);
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  if (student.status !== 'archived') return res.status(409).json({ message: 'This student is not archived.' });
  const duplicate = await findDuplicateStudent({
    name: student.name, parent: student.parent, birthdate: student.birthdate, className: student.className,
  }, student._id);
  if (duplicate) {
    return res.status(409).json({ message: `An active record for ${duplicate.name} already exists. Edit that record instead.` });
  }
  student.status = 'active';
  await student.save();
  await logActivity(req.user._id, 'student-restored', student.name);
  res.json({ student, message: `${student.name} was restored.` });
};

// DELETE /api/students/:id  (admin: permanently delete an archived student now)
exports.deleteArchivedStudent = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ message: 'Student not found.' });
  const student = await Student.findById(req.params.id).select('status name');
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  if (student.status !== 'archived') {
    return res.status(409).json({ message: 'Only archived students can be permanently deleted. Archive the student first.' });
  }
  try {
    await permanentlyDeleteStudent(student._id, req.user._id);
    res.json({ message: `${student.name} was permanently deleted.` });
  } catch (err) {
    console.error('[students] Permanent delete failed:', err.message);
    res.status(500).json({ message: 'Could not delete this student.' });
  }
};
