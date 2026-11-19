const PickupAuthorization = require('../models/PickupAuthorization');
const { isOfficeRole } = require('../config/permissions');
const Student = require('../models/Student');
const logActivity = require('../utils/logActivity');
const mongoose = require('mongoose');
const { phoneIsValid, escapeRegex } = require('../utils/validation');

async function canManageStudent(req, studentId) {
  if (isOfficeRole(req.user.role)) return true;
  if (!['teacher', 'parent'].includes(req.user.role)) return false;
  const relationship = req.user.role === 'teacher' ? { teacher: req.user._id } : { parent: req.user._id };
  return Boolean(await Student.exists({ _id: studentId, ...relationship }));
}

function pickupFieldError({ authorizedName, relationship, contact, identification }, partial = false) {
  const required = { authorizedName, relationship, contact };
  for (const [field, value] of Object.entries(required)) {
    if (partial && value === undefined) continue;
    if (typeof value !== 'string' || !value.trim()) {
      return 'Name, relationship and contact number are required.';
    }
  }
  if (authorizedName !== undefined && authorizedName.trim().length > 120) return 'Name must be 120 characters or fewer.';
  if (relationship !== undefined && relationship.trim().length > 60) return 'Relationship must be 60 characters or fewer.';
  if (contact !== undefined && !phoneIsValid(contact.trim())) return 'Enter a valid contact number (7 to 15 digits).';
  if (identification !== undefined && identification !== null && String(identification).length > 200) {
    return 'Identification details must be 200 characters or fewer.';
  }
  return '';
}

// The same person (name ignoring case and spacing) listed twice for one student.
function findDuplicatePickup(student, authorizedName, excludeId = null) {
  const clean = authorizedName.trim().replace(/\s+/g, ' ');
  const filter = {
    student,
    authorizedName: new RegExp(`^\\s*${escapeRegex(clean).replace(/ /g, '\\s+')}\\s*$`, 'i'),
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return PickupAuthorization.findOne(filter).select('_id authorizedName');
}

// POST /api/pickup   (admin, teacher, or parent registers an authorized pickup person)
exports.addAuthorization = async (req, res) => {
  try {
    const { student, authorizedName, relationship, contact, identification } = req.body;
    if (!mongoose.isObjectIdOrHexString(student)) return res.status(400).json({ message: 'Choose a valid student.' });
    if (!(await canManageStudent(req, student))) {
      return res.status(403).json({ message: 'You can only manage pickup info for students assigned to you.' });
    }
    const fieldError = pickupFieldError({ authorizedName, relationship, contact, identification });
    if (fieldError) return res.status(400).json({ message: fieldError });
    const duplicate = await findDuplicatePickup(student, authorizedName);
    if (duplicate) {
      return res.status(409).json({ message: `${duplicate.authorizedName} is already an authorized pickup person for this student. Edit that entry instead.` });
    }
    const record = await PickupAuthorization.create({
      student,
      authorizedName,
      relationship,
      contact,
      identification: identification || '',
      addedBy: req.user._id,
    });
    await logActivity(req.user._id, 'pickup-added', `${authorizedName} for student ${student}`);
    res.status(201).json({ authorization: record });
  } catch (err) {
    if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ message: err.message });
    res.status(500).json({ message: 'Could not save pickup authorization.', error: err.message });
  }
};

// GET /api/pickup/student/:studentId
exports.getStudentAuthorizations = async (req, res) => {
  if (!(await canManageStudent(req, req.params.studentId))) {
    return res.status(403).json({ message: 'Not authorized to view this record.' });
  }
  const list = await PickupAuthorization.find({ student: req.params.studentId });
  res.json({ authorizations: list });
};

// PATCH /api/pickup/:id   (admin, teacher, or parent updates an authorized pickup person)
exports.updateAuthorization = async (req, res) => {
  try {
    const { authorizedName, relationship, contact, identification } = req.body;
    const record = await PickupAuthorization.findById(req.params.id);
    if (!record) return res.status(404).json({ message: 'Authorization not found.' });

    if (!(await canManageStudent(req, record.student))) {
      return res.status(403).json({ message: 'You can only manage pickup info for students assigned to you.' });
    }

    const fieldError = pickupFieldError({ authorizedName, relationship, contact, identification }, true);
    if (fieldError) return res.status(400).json({ message: fieldError });
    if (authorizedName !== undefined) {
      const duplicate = await findDuplicatePickup(record.student, authorizedName, record._id);
      if (duplicate) {
        return res.status(409).json({ message: `${duplicate.authorizedName} is already an authorized pickup person for this student.` });
      }
    }

    if (authorizedName !== undefined) record.authorizedName = authorizedName;
    if (relationship !== undefined) record.relationship = relationship;
    if (contact !== undefined) record.contact = contact;
    if (identification !== undefined) record.identification = identification;

    await record.save();
    await logActivity(req.user._id, 'pickup-updated', record.authorizedName);
    res.json({ authorization: record });
  } catch (err) {
    if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ message: err.message });
    res.status(500).json({ message: 'Could not update pickup authorization.', error: err.message });
  }
};

// POST /api/pickup/:id/verify   (teacher or admin verifies a pickup at the gate)
exports.verifyAuthorization = async (req, res) => {
  const record = await PickupAuthorization.findById(req.params.id);
  if (!record) return res.status(404).json({ message: 'Authorization not found.' });
  if (!(await canManageStudent(req, record.student))) {
    return res.status(403).json({ message: 'You can only verify pickups for students assigned to you.' });
  }
  record.verified.push({ verifiedBy: req.user._id });
  await record.save();
  await logActivity(req.user._id, 'pickup-verified', record.authorizedName);
  res.json({ authorization: record });
};

// DELETE /api/pickup/:id
exports.deleteAuthorization = async (req, res) => {
  try {
    const record = await PickupAuthorization.findById(req.params.id);
    if (!record) return res.status(404).json({ message: 'Authorization not found.' });

    if (!(await canManageStudent(req, record.student))) {
      return res.status(403).json({ message: 'You can only manage pickup info for students assigned to you.' });
    }

    await record.deleteOne();
    await logActivity(req.user._id, 'pickup-removed', record.authorizedName);
    res.json({ message: 'Removed.' });
  } catch (err) {
    res.status(500).json({ message: 'Could not delete pickup authorization.', error: err.message });
  }
};
