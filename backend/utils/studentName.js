const EnrollmentApplication = require('../models/EnrollmentApplication');

// Trims and collapses repeated spaces so "  Ava   Cruz " is stored as "Ava Cruz".
function cleanStudentName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

// Validates and normalizes a name in a create/update payload (mutates data).
// Returns an error message, or '' when the payload is fine.
function normalizeStudentNameField(data) {
  if (data.name === undefined) return '';
  data.name = cleanStudentName(data.name);
  if (!data.name) return 'Student full name is required.';
  return '';
}

// The enrollment application keeps its own copy of the child's name (shown to parents and
// in the enrollment list). Keep it in step with the student record after a rename.
// Issued payment receipts intentionally keep the name they were printed with.
async function syncStudentNameCopies(student, previousName) {
  if (!student || student.name === previousName) return;
  const filter = student.enrollmentApplication
    ? { $or: [{ _id: student.enrollmentApplication }, { student: student._id }] }
    : { student: student._id };
  await EnrollmentApplication.updateMany(filter, { $set: { studentName: student.name } });
}

module.exports = { cleanStudentName, normalizeStudentNameField, syncStudentNameCopies };
