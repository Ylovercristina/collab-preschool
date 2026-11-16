const Student = require('../models/Student');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_STUDENT_NAME_LENGTH = 120;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_PATTERN.test(email.trim());
}

function phoneIsValid(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return /^[+0-9\s().-]{7,20}$/.test(String(phone || '')) && digits.length >= 7 && digits.length <= 15;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// JavaScript silently rolls impossible dates forward ("2027-02-30" becomes March 2).
// Returns false when a value starting with YYYY-MM-DD names a day that does not exist,
// or when the value cannot be parsed as a date at all.
function isRealCalendarDate(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  const text = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) {
    const [, year, month, day] = match.map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return false;
  }
  return text !== '' && !Number.isNaN(new Date(text).getTime());
}

// Checks a student's name and birthdate before saving. Returns an error message or ''.
function studentFieldError({ name, birthdate } = {}) {
  if (name !== undefined && String(name).trim().length > MAX_STUDENT_NAME_LENGTH) {
    return `Student name must be ${MAX_STUDENT_NAME_LENGTH} characters or fewer.`;
  }
  if (birthdate !== undefined && birthdate !== null && birthdate !== '') {
    if (!isRealCalendarDate(birthdate)) return 'Enter a valid birthdate.';
    if (new Date(birthdate) > new Date()) return 'Birthdate cannot be in the future.';
  }
  return '';
}

// Finds an active student that is the same child: same name (ignoring case and extra spaces)
// and the same parent. Without a parent, the same birthdate (or, failing that, the same class)
// identifies the child instead.
async function findDuplicateStudent({ name, parent, birthdate, className }, excludeId = null) {
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
  if (!cleanName) return null;
  const filter = {
    status: 'active',
    name: new RegExp(`^\\s*${escapeRegex(cleanName).replace(/ /g, '\\s+')}\\s*$`, 'i'),
  };
  if (excludeId) filter._id = { $ne: excludeId };
  if (parent) filter.parent = parent;
  else if (birthdate && isRealCalendarDate(birthdate)) filter.birthdate = new Date(birthdate);
  else filter.className = String(className || 'Unassigned').trim();
  return Student.findOne(filter).select('_id name');
}

module.exports = {
  MAX_STUDENT_NAME_LENGTH,
  isValidEmail,
  phoneIsValid,
  escapeRegex,
  isRealCalendarDate,
  studentFieldError,
  findDuplicateStudent,
};
