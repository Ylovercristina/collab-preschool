const PickupAuthorization = require('../models/PickupAuthorization');
const Student = require('../models/Student');
const logActivity = require('../utils/logActivity');

// POST /api/pickup   (parent registers an authorized pickup person)
exports.addAuthorization = async (req, res) => {
  try {
    const { student, authorizedName, relationship, contact } = req.body;
    if (req.user.role === 'parent') {
      const owns = await Student.findOne({ _id: student, parent: req.user._id });
      if (!owns) return res.status(403).json({ message: 'You can only manage pickup info for your own child.' });
    }
    const record = await PickupAuthorization.create({ student, authorizedName, relationship, contact, addedBy: req.user._id });
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

// POST /api/pickup/:id/verify   (teacher verifies a pickup at the gate)
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
  const record = await PickupAuthorization.findByIdAndDelete(req.params.id);
  if (!record) return res.status(404).json({ message: 'Authorization not found.' });
  res.json({ message: 'Removed.' });
};
