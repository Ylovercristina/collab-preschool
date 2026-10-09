const User = require('../models/User');
const mongoose = require('mongoose');
const logActivity = require('../utils/logActivity');
const fs = require('fs');
const path = require('path');

function publicUser(u) {
  return { id: u._id, name: u.name, email: u.email, role: u.role, status: u.status, phone: u.phone, createdAt: u.createdAt };
}

function profileUser(user) {
  const nameParts = (user.name || '').trim().split(/\s+/).filter(Boolean);
  const firstName = user.firstName || nameParts.shift() || '';
  const lastName = user.lastName || (nameParts.length ? nameParts.pop() : '');
  const middleName = user.middleName || nameParts.join(' ');
  return {
    id: user._id,
    name: user.name,
    firstName,
    middleName,
    lastName,
    email: user.email,
    role: user.role,
    phone: user.phone || '',
    address: user.address || '',
    avatar: user.avatar || null,
    childrenNames: user.role === 'parent' ? user.childrenNames || [] : [],
  };
}

function editableUser(user) {
  return { ...profileUser(user), status: user.status };
}

async function removeProfileImage(avatar) {
  const prefix = '/uploads/profiles/';
  if (typeof avatar !== 'string' || !avatar.startsWith(prefix)) return;
  const filename = avatar.slice(prefix.length);
  if (!filename || path.basename(filename) !== filename) return;
  try {
    await fs.promises.unlink(path.join(__dirname, '..', 'uploads', 'profiles', filename));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not remove old profile image:', err.message);
  }
}

async function discardUploadedImage(file) {
  if (!file) return;
  try {
    await fs.promises.unlink(file.path);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not remove rejected profile image:', err.message);
  }
}

async function hasSupportedImageSignature(file) {
  const handle = await fs.promises.open(file.path, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (file.mimetype === 'image/jpeg') return bytesRead >= 3 && header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF;
    if (file.mimetype === 'image/png') return bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    if (file.mimetype === 'image/webp') return bytesRead >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';
    return false;
  } finally {
    await handle.close();
  }
}

exports.getMyProfile = async (req, res) => {
  res.json({ user: profileUser(req.user) });
};

exports.updateMyProfile = async (req, res) => {
  let imageSaved = false;
  try {
    const firstName = String(req.body.firstName || '').trim();
    const middleName = String(req.body.middleName || '').trim();
    const lastName = String(req.body.lastName || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const address = String(req.body.address || '').trim();
    const phone = String(req.body.phone || '').trim();
    const phoneDigits = phone.replace(/\D/g, '');
    const name = [firstName, middleName, lastName].filter(Boolean).join(' ');

    if (!firstName || !lastName || !email || !address || !phone) {
      await discardUploadedImage(req.file);
      return res.status(400).json({ message: 'First name, last name, email, address and contact number are required.' });
    }
    if (firstName.length > 80 || middleName.length > 80 || lastName.length > 80 || address.length > 500) {
      await discardUploadedImage(req.file);
      return res.status(400).json({ message: 'A name field or address is too long.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await discardUploadedImage(req.file);
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    if (!/^\+?[0-9\s().-]{7,20}$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
      await discardUploadedImage(req.file);
      return res.status(400).json({ message: 'Enter a valid contact number.' });
    }
    if (req.file && !(await hasSupportedImageSignature(req.file))) {
      await discardUploadedImage(req.file);
      return res.status(400).json({ message: 'Profile image must be a valid JPG, PNG or WEBP file.' });
    }

    const duplicate = await User.findOne({ email, _id: { $ne: req.user._id } });
    if (duplicate) {
      await discardUploadedImage(req.file);
      return res.status(409).json({ message: 'That email address is already in use.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      await discardUploadedImage(req.file);
      return res.status(404).json({ message: 'User not found.' });
    }

    let childrenNames = user.childrenNames || [];
    if (user.role === 'parent' && req.body.childrenNames !== undefined) {
      try {
        childrenNames = JSON.parse(req.body.childrenNames);
      } catch (err) {
        await discardUploadedImage(req.file);
        return res.status(400).json({ message: 'Child names must be a valid list.' });
      }
      if (!Array.isArray(childrenNames) || childrenNames.some((childName) => typeof childName !== 'string' || childName.trim().length > 120)) {
        await discardUploadedImage(req.file);
        return res.status(400).json({ message: 'Enter valid child names.' });
      }
      childrenNames = childrenNames.map((childName) => childName.trim()).filter(Boolean);
    }

    const previousAvatar = user.avatar;
    user.name = name;
    user.firstName = firstName;
    user.middleName = middleName;
    user.lastName = lastName;
    user.email = email;
    user.address = address;
    user.phone = phone;
    user.childrenNames = childrenNames;
    if (req.file) user.avatar = `/uploads/profiles/${req.file.filename}`;

    await user.save();
    imageSaved = true;
    if (req.file && previousAvatar !== user.avatar) await removeProfileImage(previousAvatar);
    return res.json({ message: 'Profile updated.', user: profileUser(user) });
  } catch (err) {
    if (!imageSaved) await discardUploadedImage(req.file);
    if (err.code === 11000) return res.status(409).json({ message: 'That email address is already in use.' });
    if (err.name === 'ValidationError') return res.status(400).json({ message: err.message });
    console.error('Could not update profile:', err.message);
    return res.status(500).json({ message: 'Could not update your profile. Please try again.' });
  }
};

exports.getUserForEdit = async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    return res.status(404).json({ message: 'User not found.' });
  }
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.status === 'archived') {
      return res.status(404).json({ message: 'User not found.' });
    }
    return res.json({ user: editableUser(user) });
  } catch (err) {
    console.error('Could not load user profile:', err.message);
    return res.status(500).json({ message: 'Could not load user. Please try again.' });
  }
};

exports.updateUserProfile = async (req, res) => {
  let imageSaved = false;
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) {
      await discardUploadedImage(req.file);
      return res.status(404).json({ message: 'User not found.' });
    }

    const user = await User.findById(req.params.id);
    if (!user || user.status === 'archived') {
      await discardUploadedImage(req.file);
      return res.status(404).json({ message: 'User not found.' });
    }

    const firstName = String(req.body.firstName || '').trim();
    const middleName = String(req.body.middleName || '').trim();
    const lastName = String(req.body.lastName || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const address = String(req.body.address || '').trim();
    const role = String(req.body.role || '').trim();
    const phoneDigits = phone.replace(/\D/g, '');
    const name = [firstName, middleName, lastName].filter(Boolean).join(' ');

    if (!firstName || !lastName || !email || !phone || !address || !role) {
      await discardUploadedImage(req.file);
      return res.status(400).json({ message: 'First name, last name, email, contact number, address and role are required.' });
    }
    if (firstName.length > 80 || middleName.length > 80 || lastName.length > 80 || address.length > 500) {
      await discardUploadedImage(req.file);
      return res.status(400).json({ message: 'A name field or address is too long.' });
    }
    if (!['admin', 'teacher', 'parent'].includes(role)) {
      await discardUploadedImage(req.file);
      return res.status(400).json({ message: 'Select a valid account role.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await discardUploadedImage(req.file);
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    if (!/^\+?[0-9\s().-]{7,20}$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
      await discardUploadedImage(req.file);
      return res.status(400).json({ message: 'Enter a valid contact number.' });
    }
    if (req.file && !(await hasSupportedImageSignature(req.file))) {
      await discardUploadedImage(req.file);
      return res.status(400).json({ message: 'Profile image must be a valid JPG, PNG or WEBP file.' });
    }

    const duplicate = await User.findOne({ email, _id: { $ne: user._id } });
    if (duplicate) {
      await discardUploadedImage(req.file);
      return res.status(409).json({ message: 'That email address is already in use.' });
    }

    let childrenNames = user.role === 'parent' ? user.childrenNames || [] : [];
    if (role === 'parent' && req.body.childrenNames !== undefined) {
      try {
        childrenNames = JSON.parse(req.body.childrenNames);
      } catch (err) {
        await discardUploadedImage(req.file);
        return res.status(400).json({ message: 'Child names must be a valid list.' });
      }
      if (!Array.isArray(childrenNames) || childrenNames.some((childName) => typeof childName !== 'string' || childName.trim().length > 120)) {
        await discardUploadedImage(req.file);
        return res.status(400).json({ message: 'Enter valid child names.' });
      }
      childrenNames = childrenNames.map((childName) => childName.trim()).filter(Boolean);
    }

    const previousAvatar = user.avatar;
    user.firstName = firstName;
    user.middleName = middleName;
    user.lastName = lastName;
    user.name = name;
    user.email = email;
    user.phone = phone;
    user.address = address;
    user.role = role;
    user.childrenNames = role === 'parent' ? childrenNames : [];
    if (req.file) user.avatar = `/uploads/profiles/${req.file.filename}`;

    await user.save();
    imageSaved = true;
    if (req.file && previousAvatar !== user.avatar) await removeProfileImage(previousAvatar);
    await logActivity(req.user._id, 'user-updated', `Updated ${user.email}`);
    return res.json({ message: 'User updated.', user: editableUser(user) });
  } catch (err) {
    if (!imageSaved) await discardUploadedImage(req.file);
    if (err.code === 11000) return res.status(409).json({ message: 'That email address is already in use.' });
    if (err.name === 'ValidationError') return res.status(400).json({ message: err.message });
    console.error('Could not update user profile:', err.message);
    return res.status(500).json({ message: 'Could not update user. Please try again.' });
  }
};

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
