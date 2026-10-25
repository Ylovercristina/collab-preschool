const Classroom = require('../models/Classroom');

const UNASSIGNED = 'Unassigned';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Matches a class name to a managed class. Once any class has been set up,
// students may only be placed in an active class (or left Unassigned).
// Returns { className, teacher } on success or { error }.
async function resolveClassAssignment(className) {
  const name = String(className || '').trim();
  if (!name || name.toLowerCase() === UNASSIGNED.toLowerCase()) return { className: UNASSIGNED, teacher: undefined };
  const classroom = await Classroom.findOne({ nameKey: name.toLowerCase() });
  if (classroom) {
    if (classroom.status !== 'active') return { error: `Class "${classroom.name}" is archived. Choose an active class.` };
    return { className: classroom.name, teacher: classroom.teacher || undefined, classroom };
  }
  if (await Classroom.exists({})) return { error: `Class "${name}" does not exist. Create it under Classes first, or choose an existing class.` };
  return { className: name, teacher: undefined };
}

// Applies class rules to a student create/update payload (mutates data).
// A student in a managed class always gets that class's teacher, which is what grants teacher access.
// Returns an error message, or '' when the payload is valid.
async function applyClassToStudentData(data, currentClassName = '') {
  const current = String(currentClassName || '').trim().toLowerCase();
  const changing = data.className !== undefined && String(data.className).trim().toLowerCase() !== current;
  if (changing) {
    const resolved = await resolveClassAssignment(data.className);
    if (resolved.error) return resolved.error;
    data.className = resolved.className;
    if (resolved.teacher) data.teacher = resolved.teacher;
    else if (resolved.classroom && data.teacher === undefined) data.teacher = null;
    return '';
  }
  if (data.teacher !== undefined && current) {
    const classroom = await Classroom.findOne({ nameKey: current, status: 'active' });
    if (classroom && classroom.teacher) data.teacher = classroom.teacher;
  }
  return '';
}

module.exports = { UNASSIGNED, escapeRegex, resolveClassAssignment, applyClassToStudentData };
