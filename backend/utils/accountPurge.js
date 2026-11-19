const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Student = require('../models/Student');
const Classroom = require('../models/Classroom');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Notification = require('../models/Notification');
const EmailLog = require('../models/EmailLog');
const EnrollmentApplication = require('../models/EnrollmentApplication');
const GoogleDriveConnection = require('../models/GoogleDriveConnection');
const PersonalGoogleCalendarConnection = require('../models/PersonalGoogleCalendarConnection');
const PersonalGoogleCalendarEvent = require('../models/PersonalGoogleCalendarEvent');
const ImportedGoogleCalendarEvent = require('../models/ImportedGoogleCalendarEvent');
const Attendance = require('../models/Attendance');
const AcademicProgress = require('../models/AcademicProgress');
const PickupAuthorization = require('../models/PickupAuthorization');
const EmergencyAlert = require('../models/EmergencyAlert');
const logActivity = require('./logActivity');

const PRIVATE_RECORDS = path.join(__dirname, '..', 'private-records');
const STUDENT_PHOTO_DIR = path.join(PRIVATE_RECORDS, 'student-photos');
const PROGRESS_PHOTO_DIR = path.join(PRIVATE_RECORDS, 'progress');

const ARCHIVE_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000; // hourly

function deletionDate(archivedAt) {
  return archivedAt ? new Date(new Date(archivedAt).getTime() + ARCHIVE_RETENTION_DAYS * DAY_MS) : null;
}

async function removeFile(directory, filename) {
  if (!filename || path.basename(filename) !== filename) return;
  try {
    await fs.promises.unlink(path.join(directory, filename));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[account-purge] Could not remove file:', err.message);
  }
}

// Permanently deletes an account and the data that only belongs to it.
// School history (attendance, progress, payments, activity logs) is kept; links to the
// account on students and classes are cleared so nothing points at a missing user.
async function permanentlyDeleteUser(userId, actorId = null) {
  const user = await User.findById(userId).select('+documents');
  if (!user) return false;
  const id = user._id;

  await Promise.all([
    Student.updateMany({ teacher: id }, { $unset: { teacher: '' } }),
    Student.updateMany({ parent: id }, { $unset: { parent: '' } }),
    Classroom.updateMany({ teacher: id }, { $set: { teacher: null } }),
    Message.deleteMany({ $or: [{ sender: id }, { receiver: id }] }),
    Conversation.updateMany({ participants: id }, { $pull: { participants: id } }),
    Notification.deleteMany({ parent: id }),
    EmailLog.deleteMany({ parent: id }),
    EnrollmentApplication.deleteMany({ applicant: id, status: { $in: ['pending', 'rejected'] } }),
    GoogleDriveConnection.deleteMany({ userId: id }),
    PersonalGoogleCalendarConnection.deleteMany({ userId: id }),
    PersonalGoogleCalendarEvent.deleteMany({ userId: id }),
    ImportedGoogleCalendarEvent.deleteMany({ userId: id }),
  ]);
  await Message.updateMany({ readBy: id }, { $pull: { readBy: id } });

  if (typeof user.avatar === 'string' && user.avatar.startsWith('/uploads/profiles/')) {
    await removeFile(path.join(__dirname, '..', 'uploads', 'profiles'), user.avatar.slice('/uploads/profiles/'.length));
  }
  await Promise.all((user.documents || []).map((document) => removeFile(path.join(__dirname, '..', 'private-records'), document.filename)));

  await User.deleteOne({ _id: id });
  await logActivity(actorId, 'user-deleted-permanently', `${user.email} (${user.role})`);
  return true;
}

// Permanently deletes a student and the records that only describe that child:
// attendance, progress (with photos), pickup authorizations, notifications, the enrollment
// application, the student photo and uploaded documents. Fees and payments are kept as
// financial history (receipts keep the name they were issued with).
async function permanentlyDeleteStudent(studentId, actorId = null) {
  const student = await Student.findById(studentId).select('+documents');
  if (!student) return false;
  const id = student._id;

  const progressEntries = await AcademicProgress.find({ student: id }).select('attachments');
  const progressFiles = progressEntries.flatMap((entry) => (entry.attachments || []).map((attachment) => attachment.filename));
  const applications = await EnrollmentApplication.find({ $or: [{ student: id }, ...(student.enrollmentApplication ? [{ _id: student.enrollmentApplication }] : [])] }).select('studentPhoto');

  await Promise.all([
    Attendance.deleteMany({ student: id }),
    AcademicProgress.deleteMany({ student: id }),
    PickupAuthorization.deleteMany({ student: id }),
    Notification.deleteMany({ student: id }),
    Message.updateMany({ student: id }, { $unset: { student: '' } }),
    Conversation.updateMany({ students: id }, { $pull: { students: id } }),
    EmergencyAlert.updateMany({ students: id }, { $pull: { students: id } }),
    EnrollmentApplication.deleteMany({ _id: { $in: applications.map((application) => application._id) } }),
  ]);

  await Promise.all([
    ...progressFiles.map((filename) => removeFile(PROGRESS_PHOTO_DIR, filename)),
    ...applications.filter((application) => application.studentPhoto).map((application) => removeFile(STUDENT_PHOTO_DIR, application.studentPhoto.filename)),
    student.photo ? removeFile(STUDENT_PHOTO_DIR, student.photo.filename) : null,
    ...(student.documents || []).map((document) => removeFile(PRIVATE_RECORDS, document.filename)),
  ]);

  await Student.deleteOne({ _id: id });
  await logActivity(actorId, 'student-deleted-permanently', `${student.name}${student.studentId ? ` (${student.studentId})` : ''}`);
  return true;
}

// Accounts/students archived before archivedAt existed get today's date, so they get the full 30 days.
async function backfillArchivedAt(Model) {
  await Model.updateMany(
    { status: 'archived', $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }] },
    { $set: { archivedAt: new Date() } },
  );
}

async function purgeExpired(Model, deleteOne, label) {
  await backfillArchivedAt(Model);
  const cutoff = new Date(Date.now() - ARCHIVE_RETENTION_DAYS * DAY_MS);
  const expired = await Model.find({ status: 'archived', archivedAt: { $lte: cutoff } }).select('_id');
  let deleted = 0;
  for (const { _id } of expired) {
    try {
      if (await deleteOne(_id)) deleted += 1;
    } catch (err) {
      console.error(`[account-purge] Could not delete archived ${label}:`, err.message);
    }
  }
  if (deleted) console.log(`[account-purge] Permanently deleted ${deleted} archived ${label}(s).`);
  return deleted;
}

// Deletes archived accounts and students whose 30 days have passed.
async function purgeExpiredArchivedAccounts() {
  const users = await purgeExpired(User, (id) => permanentlyDeleteUser(id), 'account');
  const students = await purgeExpired(Student, (id) => permanentlyDeleteStudent(id), 'student');
  return users + students;
}

function startArchivedAccountPurge() {
  const run = () => purgeExpiredArchivedAccounts().catch((err) => console.error('[account-purge] Run failed:', err.message));
  run();
  setInterval(run, PURGE_INTERVAL_MS).unref();
}

module.exports = {
  ARCHIVE_RETENTION_DAYS,
  deletionDate,
  permanentlyDeleteUser,
  permanentlyDeleteStudent,
  purgeExpiredArchivedAccounts,
  startArchivedAccountPurge,
};
