const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Student = require('../models/Student');
const User = require('../models/User');
const { uploadDirectory } = require('../middleware/recordUpload');
const logActivity = require('../utils/logActivity');
const { applyClassToStudentData } = require('../utils/classAssignment');

const studentFields = ['name', 'className', 'birthdate', 'enrollmentDate', 'guardianName', 'guardianPhone', 'parent', 'teacher', 'notes'];
const teacherFields = ['name', 'phone', 'assignedClass', 'employmentStartDate', 'employmentType'];

function selectedFields(body, fields) {
  return fields.reduce((result, field) => {
    if (body[field] !== undefined) result[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
    return result;
  }, {});
}

function invalidObjectId(id) {
  return !mongoose.isObjectIdOrHexString(id);
}

function phoneIsValid(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return /^[+0-9\s().-]{7,20}$/.test(String(phone || '')) && digits.length >= 7 && digits.length <= 15;
}

async function validateStudentReferences(data) {
  if (data.parent && !(await User.exists({ _id: data.parent, role: 'parent' }))) {
    return 'Select a valid parent or guardian account.';
  }
  if (data.teacher && !(await User.exists({ _id: data.teacher, role: 'teacher' }))) {
    return 'Select a valid teacher account.';
  }
  return '';
}

function handleDatabaseError(res, err, fallback) {
  if (err.code === 11000) return res.status(409).json({ message: 'That record ID or email address is already in use.' });
  if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ message: err.message });
  console.error(`${fallback}:`, err);
  return res.status(500).json({ message: fallback });
}

async function populatedStudent(id) {
  return Student.findById(id)
    .select('+documents')
    .populate('parent', 'name email phone')
    .populate('teacher', 'name email');
}

exports.listStudents = async (req, res) => {
  try {
    const students = await Student.find()
      .select('+documents')
      .populate('parent', 'name email phone')
      .populate('teacher', 'name email')
      .sort({ name: 1 });
    res.json({ students });
  } catch (err) {
    handleDatabaseError(res, err, 'Could not load student records.');
  }
};

exports.createStudent = async (req, res) => {
  try {
    const data = selectedFields(req.body, studentFields);
    if (!data.name || !data.className) return res.status(400).json({ message: 'Student name and class or section are required.' });
    const classError = await applyClassToStudentData(data);
    if (classError) return res.status(400).json({ message: classError });
    const referenceError = await validateStudentReferences(data);
    if (referenceError) return res.status(400).json({ message: referenceError });
    const student = await Student.create(data);
    await logActivity(req.user._id, 'student-record-created', student.name);
    res.status(201).json({ student: await populatedStudent(student._id) });
  } catch (err) {
    handleDatabaseError(res, err, 'Could not create student record.');
  }
};

exports.updateStudent = async (req, res) => {
  try {
    if (invalidObjectId(req.params.id)) return res.status(404).json({ message: 'Student not found.' });
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student not found.' });
    const data = selectedFields(req.body, studentFields);
    if (data.name === '' || (data.name === undefined && !student.name)) return res.status(400).json({ message: 'Student name is required.' });
    if (data.className === '' || (data.className === undefined && !student.className)) return res.status(400).json({ message: 'Student class or section is required.' });
    const classError = await applyClassToStudentData(data, student.className);
    if (classError) return res.status(400).json({ message: classError });
    const referenceError = await validateStudentReferences(data);
    if (referenceError) return res.status(400).json({ message: referenceError });
    Object.assign(student, data);
    await student.save();
    await logActivity(req.user._id, 'student-record-updated', student.name);
    res.json({ student: await populatedStudent(student._id) });
  } catch (err) {
    handleDatabaseError(res, err, 'Could not update student record.');
  }
};

exports.listTeachers = async (req, res) => {
  try {
    const teachers = await User.find({ role: 'teacher' }).select('+documents').sort({ name: 1 });
    res.json({ teachers });
  } catch (err) {
    handleDatabaseError(res, err, 'Could not load teacher records.');
  }
};

exports.createTeacher = async (req, res) => {
  try {
    const data = selectedFields(req.body, teacherFields);
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!data.name || !email || !password || !data.phone || !data.employmentType || !data.employmentStartDate) {
      return res.status(400).json({ message: 'Name, email, contact number, password, employment type and start date are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    if (!phoneIsValid(data.phone)) return res.status(400).json({ message: 'Enter a valid contact number.' });
    const teacher = await User.create({
      ...data,
      email,
      password,
      role: 'teacher',
      status: 'approved',
      employeeId: `EMP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    });
    await logActivity(req.user._id, 'teacher-record-created', teacher.name);
    res.status(201).json({ teacher: await User.findById(teacher._id) });
  } catch (err) {
    handleDatabaseError(res, err, 'Could not create teacher record.');
  }
};

exports.updateTeacher = async (req, res) => {
  try {
    if (invalidObjectId(req.params.id)) return res.status(404).json({ message: 'Teacher not found.' });
    const teacher = await User.findOne({ _id: req.params.id, role: 'teacher' });
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });
    const data = selectedFields(req.body, teacherFields);
    if (data.name === '' || (data.name === undefined && !teacher.name)) return res.status(400).json({ message: 'Teacher name is required.' });
    if (!phoneIsValid(data.phone === undefined ? teacher.phone : data.phone)) return res.status(400).json({ message: 'Enter a valid contact number.' });
    if (!(data.employmentType === undefined ? teacher.employmentType : data.employmentType)) return res.status(400).json({ message: 'Employment type is required.' });
    if (!(data.employmentStartDate === undefined ? teacher.employmentStartDate : data.employmentStartDate)) return res.status(400).json({ message: 'Employment start date is required.' });
    Object.assign(teacher, data);
    await teacher.save();
    await logActivity(req.user._id, 'teacher-record-updated', teacher.name);
    res.json({ teacher });
  } catch (err) {
    handleDatabaseError(res, err, 'Could not update teacher record.');
  }
};

function recordModel(type) {
  if (type === 'students') return Student;
  if (type === 'teachers') return User;
  return null;
}

exports.uploadDocuments = async (req, res) => {
  const Model = recordModel(req.params.type);
  if (!Model) return res.status(404).json({ message: 'Record type not found.' });
  const files = req.files || [];
  try {
    if (invalidObjectId(req.params.id)) throw Object.assign(new Error('Record not found.'), { status: 404 });
    const query = req.params.type === 'teachers' ? { _id: req.params.id, role: 'teacher' } : { _id: req.params.id };
    const record = await Model.findOne(query).select('+documents');
    if (!record) throw Object.assign(new Error('Record not found.'), { status: 404 });
    if (!files.length) throw Object.assign(new Error('Choose at least one document to upload.'), { status: 400 });

    for (const file of files) {
      const fileHandle = await fs.promises.open(file.path, 'r');
      let header;
      try {
        header = Buffer.alloc(12);
        await fileHandle.read(header, 0, header.length, 0);
      } finally {
        await fileHandle.close();
      }
      const isValid = file.mimetype === 'application/pdf'
        ? header.toString('ascii', 0, 5) === '%PDF-'
        : file.mimetype === 'image/jpeg'
          ? header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF
          : file.mimetype === 'image/png'
            ? header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
            : file.mimetype === 'image/webp'
              ? header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
              : file.mimetype === 'application/msword'
                ? header.subarray(0, 8).equals(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))
                : header[0] === 0x50 && header[1] === 0x4B;
      if (!isValid) throw Object.assign(new Error(`${file.originalname} is not a valid ${path.extname(file.originalname).slice(1).toUpperCase()} file.`), { status: 400 });
    }

    record.documents.push(...files.map((file) => ({
      originalName: path.basename(file.originalname),
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
    })));
    await record.save();
    await logActivity(req.user._id, 'record-document-uploaded', `${req.params.type} ${record.name}`);
    res.status(201).json({ documents: record.documents });
  } catch (err) {
    await Promise.all(files.map((file) => fs.promises.unlink(file.path).catch((unlinkError) => {
      if (unlinkError.code !== 'ENOENT') console.error('Could not remove rejected record document:', unlinkError);
    })));
    if (err.status) return res.status(err.status).json({ message: err.message });
    handleDatabaseError(res, err, 'Could not upload document.');
  }
};

async function findDocument(type, id, documentId) {
  const Model = recordModel(type);
  if (!Model || invalidObjectId(id) || invalidObjectId(documentId)) return null;
  const query = type === 'teachers' ? { _id: id, role: 'teacher' } : { _id: id };
  const record = await Model.findOne(query).select('+documents');
  if (!record) return null;
  const document = record.documents.id(documentId);
  return document ? { record, document } : null;
}

exports.downloadDocument = async (req, res) => {
  try {
    const result = await findDocument(req.params.type, req.params.id, req.params.documentId);
    if (!result || path.basename(result.document.filename) !== result.document.filename) {
      return res.status(404).json({ message: 'Document not found.' });
    }
    const inline = result.document.mimetype === 'application/pdf' || result.document.mimetype.startsWith('image/');
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(result.document.mimetype);
    res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(result.document.originalName)}"`);
    return res.sendFile(path.join(uploadDirectory, result.document.filename), (err) => {
      if (err && !res.headersSent) res.status(err.code === 'ENOENT' ? 404 : 500).json({ message: 'Could not retrieve document.' });
    });
  } catch (err) {
    handleDatabaseError(res, err, 'Could not retrieve document.');
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const result = await findDocument(req.params.type, req.params.id, req.params.documentId);
    if (!result || path.basename(result.document.filename) !== result.document.filename) {
      return res.status(404).json({ message: 'Document not found.' });
    }
    await fs.promises.unlink(path.join(uploadDirectory, result.document.filename));
    result.document.deleteOne();
    await result.record.save();
    await logActivity(req.user._id, 'record-document-deleted', `${req.params.type} ${result.record.name}`);
    res.json({ documents: result.record.documents });
  } catch (err) {
    handleDatabaseError(res, err, 'Could not delete document.');
  }
};
