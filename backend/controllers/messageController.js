const Message = require('../models/Message');
const Student = require('../models/Student');
const User = require('../models/User');
const mongoose = require('mongoose');

async function canMessageStudent(sender, receiver, studentId) {
  if (!['teacher', 'parent'].includes(sender.role) || !['teacher', 'parent'].includes(receiver.role)
      || sender.role === receiver.role || !mongoose.isObjectIdOrHexString(studentId)) return false;
  const relationship = sender.role === 'teacher'
    ? { _id: studentId, teacher: sender._id, parent: receiver._id, status: 'active' }
    : { _id: studentId, parent: sender._id, teacher: receiver._id, status: 'active' };
  return Boolean(await Student.exists(relationship));
}

async function hasConversationAccess(user, otherUserId) {
  if (!['teacher', 'parent'].includes(user.role) || !mongoose.isObjectIdOrHexString(otherUserId)) return false;
  const other = await User.findById(otherUserId).select('role status');
  if (!other || other.status !== 'approved' || !['teacher', 'parent'].includes(other.role)
      || other.role === user.role) return false;
  const relationship = user.role === 'teacher'
    ? { teacher: user._id, parent: other._id, status: 'active' }
    : { parent: user._id, teacher: other._id, status: 'active' };
  return Boolean(await Student.exists(relationship));
}

// POST /api/messages
exports.sendMessage = async (req, res) => {
  try {
    const { receiver: receiverId, student: studentId } = req.body;
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length > 2000) {
      return res.status(400).json({ message: 'Messages must contain 1 to 2,000 characters.' });
    }
    if (!mongoose.isObjectIdOrHexString(receiverId) || !mongoose.isObjectIdOrHexString(studentId)) {
      return res.status(400).json({ message: 'Choose a valid parent, teacher and student.' });
    }
    const receiver = await User.findById(receiverId).select('role status');
    if (!receiver || receiver.status !== 'approved'
        || !(await canMessageStudent(req.user, receiver, studentId))) {
      return res.status(403).json({ message: 'You can only message the parent or teacher connected to an assigned student.' });
    }
    const message = await Message.create({ sender: req.user._id, receiver: receiver._id, student: studentId, content });
    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ message: 'Could not send message.', error: err.message });
  }
};

// GET /api/messages/thread/:userId   (conversation between me and userId)
exports.getThread = async (req, res) => {
  if (!(await hasConversationAccess(req.user, req.params.userId))) {
    return res.status(403).json({ message: 'You can only view conversations connected to your assigned students.' });
  }
  const messages = await Message.find({
    $or: [
      { sender: req.user._id, receiver: req.params.userId },
      { sender: req.params.userId, receiver: req.user._id },
    ],
  }).populate('sender', 'name role').populate('student', 'name').sort({ createdAt: 1 });

  await Message.updateMany(
    { sender: req.params.userId, receiver: req.user._id, read: false },
    { read: true }
  );

  res.json({ messages });
};

// GET /api/messages/inbox   (list of conversations with last message + unread count)
exports.getInbox = async (req, res) => {
  if (!['teacher', 'parent'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Messaging is available to teachers and parents.' });
  }
  const studentFilter = req.user.role === 'teacher'
    ? { teacher: req.user._id, status: 'active' }
    : { parent: req.user._id, status: 'active' };
  const students = await Student.find(studentFilter).select('parent teacher');
  const allowedUserIds = new Set(students.map((student) => {
    const other = req.user.role === 'teacher' ? student.parent : student.teacher;
    return other ? other.toString() : null;
  }).filter(Boolean));
  const messages = await Message.find({
    $or: [
      { sender: req.user._id, receiver: { $in: [...allowedUserIds] } },
      { receiver: req.user._id, sender: { $in: [...allowedUserIds] } },
    ],
  })
    .populate('sender', 'name role')
    .populate('receiver', 'name role')
    .sort({ createdAt: -1 });

  const threads = new Map();
  for (const m of messages) {
    const otherId = m.sender._id.equals(req.user._id) ? m.receiver._id.toString() : m.sender._id.toString();
    if (!threads.has(otherId)) {
      const other = m.sender._id.equals(req.user._id) ? m.receiver : m.sender;
      threads.set(otherId, { with: { id: other._id, name: other.name, role: other.role }, lastMessage: m, unread: 0 });
    }
    if (m.receiver._id.equals(req.user._id) && !m.read) threads.get(otherId).unread += 1;
  }
  res.json({ threads: Array.from(threads.values()) });
};
