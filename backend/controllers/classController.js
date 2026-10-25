const mongoose = require('mongoose');
const Classroom = require('../models/Classroom');
const Student = require('../models/Student');
const User = require('../models/User');
const logActivity = require('../utils/logActivity');
const { UNASSIGNED, escapeRegex } = require('../utils/classAssignment');

const exactName = (name) => new RegExp(`^${escapeRegex(name)}$`, 'i');

async function populated(id) {
  return Classroom.findById(id).populate('teacher', 'name email status');
}

async function validateTeacher(teacherId, classId) {
  if (!teacherId) return { teacher: null };
  if (!mongoose.isObjectIdOrHexString(teacherId)) return { error: 'Select a valid teacher.' };
  const teacher = await User.findOne({ _id: teacherId, role: 'teacher', status: { $ne: 'archived' } });
  if (!teacher) return { error: 'Select an active teacher account.' };
  const otherClass = await Classroom.findOne({ teacher: teacher._id, status: 'active', _id: { $ne: classId } });
  if (otherClass) return { error: `${teacher.name} already leads ${otherClass.name}. Remove them from that class first.` };
  return { teacher };
}

function readName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Class name is required.' };
  if (name.length > 80) return { error: 'Class name must be 80 characters or fewer.' };
  if (name.toLowerCase() === UNASSIGNED.toLowerCase()) return { error: '"Unassigned" is reserved. Choose another class name.' };
  return { name };
}

// Students in a class follow the class teacher, which is what grants teachers access.
async function applyTeacherToClass(className, teacherId) {
  const update = teacherId ? { $set: { teacher: teacherId } } : { $unset: { teacher: '' } };
  await Student.updateMany({ className: exactName(className) }, update);
  if (teacherId) await User.updateOne({ _id: teacherId }, { $set: { assignedClass: className } });
}

// GET /api/classes
exports.listClasses = async (req, res) => {
  try {
    const classes = await Classroom.find().populate('teacher', 'name email status').sort({ status: 1, name: 1 });
    const counts = await Student.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: { $toLower: { $ifNull: ['$className', ''] } }, total: { $sum: 1 } } },
    ]);
    const countFor = (key) => (counts.find((item) => item._id === key) || {}).total || 0;
    const known = new Set(classes.map((item) => item.nameKey));
    const usedNames = [
      ...await Student.distinct('className', { status: 'active' }),
      ...await User.distinct('assignedClass', { role: 'teacher' }),
    ].map((name) => String(name || '').trim()).filter((name) => name && name.toLowerCase() !== UNASSIGNED.toLowerCase());
    const unregistered = [...new Map(usedNames
      .filter((name) => !known.has(name.toLowerCase()))
      .map((name) => [name.toLowerCase(), name])).values()].sort();
    res.json({
      classes: classes.map((item) => ({ ...item.toJSON(), activeStudents: countFor(item.nameKey) })),
      unregistered,
      unassignedStudents: countFor(UNASSIGNED.toLowerCase()) + countFor(''),
    });
  } catch (err) {
    console.error('[classes] List failed:', err.message);
    res.status(500).json({ message: 'Could not load classes.' });
  }
};

// POST /api/classes
exports.createClass = async (req, res) => {
  try {
    const { name, error } = readName(req.body.name);
    if (error) return res.status(400).json({ message: error });
    if (await Classroom.exists({ nameKey: name.toLowerCase() })) return res.status(409).json({ message: `A class named "${name}" already exists.` });
    const teacherCheck = await validateTeacher(req.body.teacher || null, null);
    if (teacherCheck.error) return res.status(400).json({ message: teacherCheck.error });
    const classroom = await Classroom.create({
      name,
      description: String(req.body.description || '').trim().slice(0, 500),
      teacher: teacherCheck.teacher ? teacherCheck.teacher._id : null,
      createdBy: req.user._id,
    });
    // Adopt students already using this class name (any letter case).
    await Student.updateMany({ className: exactName(name) }, { $set: { className: name } });
    if (classroom.teacher) await applyTeacherToClass(name, classroom.teacher);
    await logActivity(req.user._id, 'class-created', name);
    res.status(201).json({ class: await populated(classroom._id) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'A class with this name already exists.' });
    console.error('[classes] Create failed:', err.message);
    res.status(500).json({ message: 'Could not create class.' });
  }
};

// PATCH /api/classes/:id
exports.updateClass = async (req, res) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ message: 'Class not found.' });
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ message: 'Class not found.' });
    const previousName = classroom.name;
    const previousTeacher = classroom.teacher ? String(classroom.teacher) : '';

    let nextName = previousName;
    if (req.body.name !== undefined) {
      const { name, error } = readName(req.body.name);
      if (error) return res.status(400).json({ message: error });
      if (name.toLowerCase() !== classroom.nameKey && await Classroom.exists({ nameKey: name.toLowerCase() })) {
        return res.status(409).json({ message: `A class named "${name}" already exists.` });
      }
      nextName = name;
    }
    let nextTeacher = previousTeacher;
    if (req.body.teacher !== undefined) {
      const teacherCheck = await validateTeacher(req.body.teacher || null, classroom._id);
      if (teacherCheck.error) return res.status(400).json({ message: teacherCheck.error });
      nextTeacher = teacherCheck.teacher ? String(teacherCheck.teacher._id) : '';
    }

    classroom.name = nextName;
    if (req.body.description !== undefined) classroom.description = String(req.body.description || '').trim().slice(0, 500);
    classroom.teacher = nextTeacher || null;
    await classroom.save();

    if (nextName !== previousName) {
      await Student.updateMany({ className: exactName(previousName) }, { $set: { className: nextName } });
      await User.updateMany({ assignedClass: exactName(previousName) }, { $set: { assignedClass: nextName } });
    }
    if (nextTeacher !== previousTeacher) {
      if (previousTeacher) await User.updateOne({ _id: previousTeacher, assignedClass: exactName(nextName) }, { $set: { assignedClass: '' } });
      await applyTeacherToClass(nextName, nextTeacher || null);
    }
    await logActivity(req.user._id, 'class-updated', nextName);
    res.json({ class: await populated(classroom._id) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'A class with this name already exists.' });
    console.error('[classes] Update failed:', err.message);
    res.status(500).json({ message: 'Could not update class.' });
  }
};

// PATCH /api/classes/:id/archive  (never deletes students, attendance or progress)
exports.archiveClass = async (req, res) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ message: 'Class not found.' });
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ message: 'Class not found.' });
    const activeStudents = await Student.countDocuments({ className: exactName(classroom.name), status: 'active' });
    if (activeStudents) {
      return res.status(409).json({ message: `Move the ${activeStudents} active student${activeStudents === 1 ? '' : 's'} in ${classroom.name} to another class before archiving it.` });
    }
    classroom.status = 'archived';
    await classroom.save();
    if (classroom.teacher) await User.updateOne({ _id: classroom.teacher, assignedClass: exactName(classroom.name) }, { $set: { assignedClass: '' } });
    await logActivity(req.user._id, 'class-archived', classroom.name);
    res.json({ class: await populated(classroom._id) });
  } catch (err) {
    console.error('[classes] Archive failed:', err.message);
    res.status(500).json({ message: 'Could not archive class.' });
  }
};

// PATCH /api/classes/:id/restore
exports.restoreClass = async (req, res) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ message: 'Class not found.' });
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ message: 'Class not found.' });
    if (classroom.teacher) {
      const teacherCheck = await validateTeacher(classroom.teacher, classroom._id);
      if (teacherCheck.error) classroom.teacher = null;
    }
    classroom.status = 'active';
    await classroom.save();
    if (classroom.teacher) await applyTeacherToClass(classroom.name, classroom.teacher);
    await logActivity(req.user._id, 'class-restored', classroom.name);
    res.json({ class: await populated(classroom._id) });
  } catch (err) {
    console.error('[classes] Restore failed:', err.message);
    res.status(500).json({ message: 'Could not restore class.' });
  }
};
