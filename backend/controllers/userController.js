const User = require('../models/User');
const logActivity = require('../utils/logActivity');

function publicUser(u) {
  return { id: u._id, name: u.name, email: u.email, role: u.role, status: u.status, phone: u.phone, createdAt: u.createdAt };
}

// GET /api/users?role=&status=   (admin)
exports.listUsers = async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.status) filter.status = req.query.status;
  const users = await User.find(filter).sort({ createdAt: -1 });
  res.json({ users: users.map(publicUser) });
};

// POST /api/users   (admin creates a teacher, or another admin)
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;
    if (!['admin', 'teacher', 'parent'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role.' });
    }
    const exists = await User.findOne({ email: (email || '').toLowerCase() });
    if (exists) return res.status(409).json({ message: 'Email already registered.' });

    const user = await User.create({ name, email, password, role, phone, status: 'approved' });
    await logActivity(req.user._id, 'user-created', `${role} ${email} created by admin`);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Could not create user.', error: err.message });
  }
};

// PATCH /api/users/:id  (edit name/phone/role)
exports.updateUser = async (req, res) => {
  try {
    const { name, phone, role } = req.body;
    const update = {};
    if (name) update.name = name;
    if (phone) update.phone = phone;
    if (role) update.role = role;

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found.' });
    await logActivity(req.user._id, 'user-updated', `Updated ${user.email}`);
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Could not update user.', error: err.message });
  }
};

// PATCH /api/users/:id/archive
exports.archiveUser = async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { status: 'archived' }, { new: true });
  if (!user) return res.status(404).json({ message: 'User not found.' });
  await logActivity(req.user._id, 'user-archived', user.email);
  res.json({ user: publicUser(user) });
};

// PATCH /api/users/:id/approve   (approve a pending parent account)
exports.approveUser = async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
  if (!user) return res.status(404).json({ message: 'User not found.' });
  await logActivity(req.user._id, 'user-approved', user.email);
  res.json({ user: publicUser(user) });
};

// PATCH /api/users/:id/reactivate
exports.reactivateUser = async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
  if (!user) return res.status(404).json({ message: 'User not found.' });
  await logActivity(req.user._id, 'user-reactivated', user.email);
  res.json({ user: publicUser(user) });
};
