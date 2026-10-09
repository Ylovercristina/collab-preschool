const PickupAuthorization = require('../models/PickupAuthorization');
const Student = require('../models/Student');
const logActivity = require('../utils/logActivity');

// POST /api/pickup   (admin, teacher, or parent registers an authorized pickup person)
exports.addAuthorization = async (req, res) => {
  try {
    const { student, authorizedName, relationship, contact, identification } = req.body;
    if (req.user.role === 'parent') {
      const owns = await Student.findOne({ _id: student, parent: req.user._id });
      if (!owns) return res.status(403).json({ message: 'You can only manage pickup info for your own child.' });
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
    res.status(500).json({ message: 'Could not save pickup authorization.', error: err.message });
  }
};

// GET /api/pickup/student/:studentId
exports.getStudentAuthorizations = async (req, res) => {
  if (req.user.role === 'parent') {
    const owns = await Student.findOne({ _id: req.params.studentId, parent: req.user._id });
    if (!owns) return res.status(403).json({ message: 'Not authorized to view this record.' });
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

    if (req.user.role === 'parent') {
      const owns = await Student.findOne({ _id: record.student, parent: req.user._id });
      if (!owns) return res.status(403).json({ message: 'You can only manage pickup info for your own child.' });
    }

    if (authorizedName !== undefined) record.authorizedName = authorizedName;
    if (relationship !== undefined) record.relationship = relationship;
    if (contact !== undefined) record.contact = contact;
    if (identification !== undefined) record.identification = identification;

    await record.save();
    await logActivity(req.user._id, 'pickup-updated', record.authorizedName);
    res.json({ authorization: record });
  } catch (err) {
    res.status(500).json({ message: 'Could not update pickup authorization.', error: err.message });
  }
};

// POST /api/pickup/:id/verify   (teacher or admin verifies a pickup at the gate)
exports.verifyAuthorization = async (req, res) => {
  const record = await PickupAuthorization.findByIdAndUpdate(
    req.params.id,
    { $push: { verified: { verifiedBy: req.user._id } } },
    { new: true }
  );
  if (!record) return res.status(404).json({ message: 'Authorization not found.' });
  await logActivity(req.user._id, 'pickup-verified', record.authorizedName);
  res.json({ authorization: record });
};

// DELETE /api/pickup/:id
exports.deleteAuthorization = async (req, res) => {
  try {
    const record = await PickupAuthorization.findById(req.params.id);
    if (!record) return res.status(404).json({ message: 'Authorization not found.' });

    if (req.user.role === 'parent') {
      const owns = await Student.findOne({ _id: record.student, parent: req.user._id });
      if (!owns) return res.status(403).json({ message: 'You can only manage pickup info for your own child.' });
    }

    await record.deleteOne();
    await logActivity(req.user._id, 'pickup-removed', record.authorizedName);
    res.json({ message: 'Removed.' });
  } catch (err) {
    res.status(500).json({ message: 'Could not delete pickup authorization.', error: err.message });
  }
};
