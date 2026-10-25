const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const AcademicProgress = require('../models/AcademicProgress');
const Student = require('../models/Student');
const logActivity = require('../utils/logActivity');
const { escapeRegex } = require('../utils/classAssignment');
const { removeUploadedFiles, progressPhotoDirectory, MAX_PHOTOS_PER_ENTRY } = require('../middleware/progressUpload');

const TEXT_LIMITS = {
  milestone: 200,
  activity: 3000,
  observations: 3000,
  assessment: 500,
  notes: 3000,
  learningArea: 100,
  evaluation: 3000,
  strengths: 2000,
  areasForImprovement: 2000,
  overallDevelopment: 3000,
};
const ENTRY_TYPES = ['activity', 'weekly', 'monthly'];
const TYPE_LABELS = { weekly: 'weekly milestone', monthly: 'monthly milestone' };

function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function parseMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return new Date(`${value}-01T00:00:00.000Z`);
}

// Weekly milestones run Monday-Sunday; monthly ones cover the calendar month (UTC dates).
function periodFor(entryType, body) {
  if (entryType === 'monthly') {
    const start = parseMonth(body.month) || (parseDay(body.date) && new Date(Date.UTC(parseDay(body.date).getUTCFullYear(), parseDay(body.date).getUTCMonth(), 1)));
    if (!start) return { error: 'Choose the month for this milestone.' };
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    return { date: start, periodStart: start, periodEnd: end };
  }
  const day = parseDay(body.date);
  if (!day) return { error: entryType === 'weekly' ? 'Choose a date in the week for this milestone.' : 'Choose a valid date.' };
  if (entryType === 'weekly') {
    const start = new Date(day);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return { date: start, periodStart: start, periodEnd: end };
  }
  return { date: day, periodStart: null, periodEnd: null };
}

// Validates body fields against an optional existing entry; returns { values } or { error }.
function readEntry(body, existing = null) {
  const values = {};
  for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'string') return { error: `Invalid value for ${field}.` };
    const text = body[field].trim();
    if (text.length > limit) return { error: `${field} must be ${limit} characters or fewer.` };
    values[field] = text;
  }
  const entryType = body.entryType === undefined ? (existing ? existing.entryType || 'activity' : 'activity') : body.entryType;
  if (!ENTRY_TYPES.includes(entryType)) return { error: 'Choose activity, weekly milestone or monthly milestone.' };
  values.entryType = entryType;

  const dateProvided = body.date !== undefined || body.month !== undefined;
  if (!existing || dateProvided || entryType !== existing.entryType) {
    const period = periodFor(entryType, dateProvided || !existing
      ? body
      : { date: new Date(existing.date).toISOString().slice(0, 10) });
    if (period.error) return period;
    Object.assign(values, period);
  }

  const merged = { ...(existing ? existing.toObject() : {}), ...values };
  if (entryType !== 'activity' && !merged.milestone) return { error: 'Give the milestone a title.' };
  if (!merged.milestone && !merged.activity) return { error: 'Enter a milestone or an activity.' };
  return { values };
}

async function findDuplicate(studentId, values, excludeId = null) {
  if (values.entryType === 'activity' || !values.milestone) return null;
  return AcademicProgress.findOne({
    _id: { $ne: excludeId },
    student: studentId,
    entryType: values.entryType,
    periodStart: values.periodStart,
    milestone: new RegExp(`^${escapeRegex(values.milestone)}$`, 'i'),
  });
}

function attachmentsFrom(files, userId) {
  return (files || []).map((file) => ({
    originalName: path.basename(file.originalname).slice(0, 200),
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    uploadedBy: userId,
  }));
}

function parseRemovals(value) {
  if (value === undefined || value === '') return [];
  let ids = value;
  if (typeof value === 'string') {
    try { ids = JSON.parse(value); } catch (err) { return null; }
  }
  if (!Array.isArray(ids) || ids.some((id) => !mongoose.isObjectIdOrHexString(id))) return null;
  return ids.map(String);
}

async function deleteStoredPhotos(attachments) {
  await Promise.all(attachments.map((attachment) => fs.promises.unlink(path.join(progressPhotoDirectory, path.basename(attachment.filename)))
    .catch((err) => { if (err.code !== 'ENOENT') console.error('[progress] Could not delete photo:', err.message); })));
}

function savedEntry(id) {
  return AcademicProgress.findById(id).populate('teacher', 'name');
}

// POST /api/progress   (teacher; multipart form with optional "photos")
exports.addProgress = async (req, res) => {
  try {
    const studentId = req.body.student;
    if (!mongoose.isObjectIdOrHexString(studentId)) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ message: 'Choose a valid student.' });
    }
    const assignedStudent = await Student.findOne({ _id: studentId, teacher: req.user._id, status: 'active' });
    if (!assignedStudent) {
      await removeUploadedFiles(req.files);
      return res.status(403).json({ message: 'You can only record progress for students assigned to you.' });
    }
    const { values, error } = readEntry(req.body);
    if (error) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ message: error });
    }
    const duplicate = await findDuplicate(assignedStudent._id, values);
    if (duplicate) {
      await removeUploadedFiles(req.files);
      return res.status(409).json({ message: `${assignedStudent.name} already has a ${TYPE_LABELS[values.entryType]} called "${duplicate.milestone}" for this period. Edit that one instead.` });
    }
    const entry = await AcademicProgress.create({
      ...values,
      student: assignedStudent._id,
      teacher: req.user._id,
      className: assignedStudent.className || '',
      attachments: attachmentsFrom(req.files, req.user._id),
    });
    await logActivity(req.user._id, 'progress-added', `${assignedStudent.name} (${values.entryType})`);
    res.status(201).json({ progress: await savedEntry(entry._id) });
  } catch (err) {
    await removeUploadedFiles(req.files);
    const status = err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500;
    if (status === 500) console.error('[progress] Create failed:', err.message);
    res.status(status).json({ message: status === 400 ? err.message : 'Could not save progress entry.' });
  }
};

// GET /api/progress/student/:studentId
exports.getStudentProgress = async (req, res) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.studentId)) return res.status(404).json({ message: 'Student not found.' });
    if (req.user.role === 'parent' || req.user.role === 'teacher') {
      const ownership = req.user.role === 'parent' ? { parent: req.user._id } : { teacher: req.user._id };
      const student = await Student.findOne({ _id: req.params.studentId, ...ownership });
      if (!student) return res.status(403).json({ message: 'Not authorized to view this record.' });
    }
    const entries = await AcademicProgress.find({ student: req.params.studentId })
      .populate('teacher', 'name')
      .sort({ date: -1, createdAt: -1 });
    // Photos are visible to staff only.
    const progress = req.user.role === 'parent'
      ? entries.map((entry) => { const value = entry.toJSON(); delete value.attachments; return value; })
      : entries;
    res.json({ progress });
  } catch (err) {
    console.error('[progress] Load failed:', err.message);
    res.status(500).json({ message: 'Could not load progress records.' });
  }
};

// PATCH /api/progress/:id   (teacher; multipart with optional "photos" and "removeAttachments")
exports.updateProgress = async (req, res) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      await removeUploadedFiles(req.files);
      return res.status(404).json({ message: 'Entry not found.' });
    }
    const existingEntry = await AcademicProgress.findOne({ _id: req.params.id, teacher: req.user._id });
    if (!existingEntry) {
      await removeUploadedFiles(req.files);
      return res.status(404).json({ message: 'Entry not found.' });
    }
    const assignedStudent = await Student.findOne({ _id: existingEntry.student, teacher: req.user._id });
    if (!assignedStudent) {
      await removeUploadedFiles(req.files);
      return res.status(403).json({ message: 'You can only update progress for students assigned to you.' });
    }
    const { values, error } = readEntry(req.body, existingEntry);
    const removals = parseRemovals(req.body.removeAttachments);
    if (error || removals === null) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ message: error || 'Invalid list of photos to remove.' });
    }
    const merged = { ...existingEntry.toObject(), ...values };
    const duplicate = await findDuplicate(existingEntry.student, merged, existingEntry._id);
    if (duplicate) {
      await removeUploadedFiles(req.files);
      return res.status(409).json({ message: `${assignedStudent.name} already has a ${TYPE_LABELS[merged.entryType]} called "${duplicate.milestone}" for this period.` });
    }
    const removed = existingEntry.attachments.filter((attachment) => removals.includes(String(attachment._id)));
    const kept = existingEntry.attachments.filter((attachment) => !removals.includes(String(attachment._id)));
    if (kept.length + (req.files || []).length > MAX_PHOTOS_PER_ENTRY) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ message: `An entry can have at most ${MAX_PHOTOS_PER_ENTRY} photos. Remove some before adding more.` });
    }
    existingEntry.set(values);
    existingEntry.attachments = [...kept, ...attachmentsFrom(req.files, req.user._id)];
    await existingEntry.save();
    await deleteStoredPhotos(removed);
    await logActivity(req.user._id, 'progress-updated', `${assignedStudent.name} (${existingEntry.entryType})`);
    res.json({ progress: await savedEntry(existingEntry._id) });
  } catch (err) {
    await removeUploadedFiles(req.files);
    const status = err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500;
    if (status === 500) console.error('[progress] Update failed:', err.message);
    res.status(status).json({ message: status === 400 ? err.message : 'Could not update progress entry.' });
  }
};

// GET /api/progress/:id/attachments/:attachmentId   (admin, or the student's teacher)
exports.getAttachment = async (req, res) => {
  try {
    const { id, attachmentId } = req.params;
    if (!mongoose.isObjectIdOrHexString(id) || !mongoose.isObjectIdOrHexString(attachmentId)) return res.status(404).json({ message: 'Photo not found.' });
    const entry = await AcademicProgress.findById(id);
    const attachment = entry && entry.attachments.id(attachmentId);
    if (!attachment) return res.status(404).json({ message: 'Photo not found.' });
    if (req.user.role === 'teacher' && !(await Student.exists({ _id: entry.student, teacher: req.user._id }))) {
      return res.status(403).json({ message: 'Not authorized to view this photo.' });
    }
    res.set({
      'Content-Type': attachment.mimetype,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
    });
    res.sendFile(path.join(progressPhotoDirectory, path.basename(attachment.filename)), (err) => {
      if (err && !res.headersSent) res.status(err.code === 'ENOENT' ? 404 : 500).json({ message: 'Photo file is missing.' });
    });
  } catch (err) {
    console.error('[progress] Photo load failed:', err.message);
    res.status(500).json({ message: 'Could not load photo.' });
  }
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

module.exports._test = { periodFor, readEntry, parseRemovals };
