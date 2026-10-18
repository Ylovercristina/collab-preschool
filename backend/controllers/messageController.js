const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Student = require('../models/Student');
const User = require('../models/User');
const mongoose = require('mongoose');

function validContent(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 2000;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function canMessageStudent(sender, receiver, studentId) {
  if (!['teacher', 'parent'].includes(sender.role) || !['teacher', 'parent'].includes(receiver.role)
      || sender.role === receiver.role || !mongoose.isObjectIdOrHexString(studentId)) return false;
  const relationship = sender.role === 'teacher'
    ? { _id: studentId, teacher: sender._id, parent: receiver._id, status: 'active' }
    : { _id: studentId, parent: sender._id, teacher: receiver._id, status: 'active' };
  return Boolean(await Student.exists(relationship));
}

async function hasConversationAccess(user, otherUserId) {
  if (!['teacher', 'parent'].includes(user.role) || user.status !== 'approved'
      || !mongoose.isObjectIdOrHexString(otherUserId)) return false;
  const other = await User.findById(otherUserId).select('role status');
  if (!other || !['teacher', 'parent'].includes(other.role) || other._id.equals(user._id)) return false;

  if (user.role === 'teacher' && other.role === 'teacher') return other.status === 'approved';
  if (user.role === other.role) return false;
  if (other.role === 'teacher' && other.status !== 'approved') return false;
  const relationship = user.role === 'teacher'
    ? { teacher: user._id, parent: other._id, status: 'active' }
    : { parent: user._id, teacher: other._id, status: 'active' };
  return Boolean(await Student.exists(relationship));
}

function messageError(res) {
  return res.status(400).json({ message: 'Messages must contain 1 to 2,000 characters.' });
}

// GET /api/messages/contacts?q=...
exports.getContacts = async (req, res) => {
  if (req.user.role !== 'teacher' || req.user.status !== 'approved') {
    return res.status(403).json({ message: 'Only teachers can search for messaging contacts.' });
  }

  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (!query) return res.json({ contacts: [] });

  const search = new RegExp(escapeRegex(query), 'i');
  const [students, teachers] = await Promise.all([
    Student.find({ teacher: req.user._id, status: 'active' })
      .select('name className parent')
      .populate({ path: 'parent', select: 'name role status', match: { role: 'parent', status: { $ne: 'archived' } } })
      .sort({ name: 1 }),
    User.find({
      role: 'teacher',
      status: 'approved',
      _id: { $ne: req.user._id },
      name: search,
    }).select('name role assignedClass').sort({ name: 1 }).limit(50),
  ]);

  const parents = new Map();
  students.forEach((student) => {
    if (!student.parent || (!search.test(student.parent.name) && !search.test(student.name))) return;
    const parentId = student.parent._id.toString();
    if (!parents.has(parentId)) {
      parents.set(parentId, {
        id: parentId,
        name: student.parent.name,
        role: 'parent',
        students: [],
      });
    }
    parents.get(parentId).students.push({
      id: student._id.toString(),
      name: student.name,
      className: student.className,
    });
  });

  const contacts = [
    ...Array.from(parents.values()),
    ...teachers.map((teacher) => ({
      id: teacher._id.toString(),
      name: teacher.name,
      role: 'teacher',
      assignedClass: teacher.assignedClass,
      students: [],
    })),
  ].sort((left, right) => left.name.localeCompare(right.name));

  res.json({ contacts });
};

// POST /api/messages
exports.sendMessage = async (req, res) => {
  try {
    if (!['teacher', 'parent'].includes(req.user.role) || req.user.status !== 'approved') {
      return res.status(403).json({ message: 'Only approved teachers and parents can send messages.' });
    }
    const { receiver: receiverId, student: studentId } = req.body;
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    if (!validContent(content)) return messageError(res);
    if (!mongoose.isObjectIdOrHexString(receiverId)) {
      return res.status(400).json({ message: 'Choose a valid message recipient.' });
    }

    const receiver = await User.findById(receiverId).select('role status');
    if (!receiver || !['teacher', 'parent'].includes(receiver.role)
        || receiver.status === 'archived'
        || (receiver.role === 'teacher' && receiver.status !== 'approved')) {
      return res.status(403).json({ message: 'This recipient is not available for messaging.' });
    }

    const isTeacherDirectMessage = req.user.role === 'teacher' && receiver.role === 'teacher';
    const isTeacherToParent = req.user.role === 'teacher' && receiver.role === 'parent';
    const hasValidStudentRelationship = studentId
      ? await canMessageStudent(req.user, receiver, studentId)
      : (isTeacherToParent && Boolean(await Student.exists({
        teacher: req.user._id,
        parent: receiver._id,
        status: 'active',
      })));
    if (isTeacherDirectMessage ? studentId : !hasValidStudentRelationship) {
      return res.status(403).json({
        message: isTeacherDirectMessage
          ? 'Coworker messages do not need a student selection.'
          : 'You can only message the parent or teacher connected to an assigned student.',
      });
    }

    const messageData = { sender: req.user._id, receiver: receiver._id, content };
    if (studentId) messageData.student = studentId;
    const message = await Message.create(messageData);
    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ message: 'Could not send message.', error: err.message });
  }
};

// GET /api/messages/thread/:userId
exports.getThread = async (req, res) => {
  if (!(await hasConversationAccess(req.user, req.params.userId))) {
    return res.status(403).json({ message: 'You can only view conversations with approved colleagues or connected families.' });
  }

  const messages = await Message.find({
    $or: [
      { sender: req.user._id, receiver: req.params.userId },
      { sender: req.params.userId, receiver: req.user._id },
    ],
    conversation: { $exists: false },
  }).populate('sender', 'name role').populate('student', 'name').sort({ createdAt: 1 });

  await Message.updateMany(
    { sender: req.params.userId, receiver: req.user._id, read: false, conversation: { $exists: false } },
    { read: true }
  );

  res.json({ messages });
};

// GET /api/messages/inbox
exports.getInbox = async (req, res) => {
  if (!['teacher', 'parent'].includes(req.user.role) || req.user.status !== 'approved') {
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

  if (req.user.role === 'teacher') {
    const colleagues = await User.find({
      role: 'teacher',
      status: 'approved',
      _id: { $ne: req.user._id },
    }).select('_id');
    colleagues.forEach((colleague) => allowedUserIds.add(colleague._id.toString()));
  }

  const messages = await Message.find({
    $or: [
      { sender: req.user._id, receiver: { $in: [...allowedUserIds] } },
      { receiver: req.user._id, sender: { $in: [...allowedUserIds] } },
    ],
    conversation: { $exists: false },
  })
    .populate('sender', 'name role')
    .populate('receiver', 'name role')
    .sort({ createdAt: -1 });

  const threads = new Map();
  for (const message of messages) {
    if (!message.sender || !message.receiver) continue;
    const sentByMe = message.sender._id.equals(req.user._id);
    const other = sentByMe ? message.receiver : message.sender;
    const otherId = other._id.toString();
    if (!threads.has(otherId)) {
      threads.set(otherId, {
        id: otherId,
        type: 'direct',
        with: { id: otherId, name: other.name, role: other.role },
        lastMessage: message,
        unread: 0,
      });
    }
    if (!sentByMe && !message.read) threads.get(otherId).unread += 1;
  }

  const conversations = await Conversation.find({ participants: req.user._id })
    .populate({ path: 'participants', select: 'name role status' })
    .populate('students', 'name className')
    .sort({ updatedAt: -1 });
  const conversationIds = conversations.map((conversation) => conversation._id);
  const groupMessages = conversationIds.length
    ? await Message.find({ conversation: { $in: conversationIds } })
      .select('conversation sender content readBy createdAt')
      .sort({ createdAt: -1 })
    : [];
  const latestGroupMessages = new Map();
  const groupUnread = new Map();
  groupMessages.forEach((message) => {
    const conversationId = message.conversation.toString();
    if (!latestGroupMessages.has(conversationId)) latestGroupMessages.set(conversationId, message);
    const alreadyRead = message.readBy.some((readerId) => readerId.equals(req.user._id));
    if (!message.sender.equals(req.user._id) && !alreadyRead) {
      groupUnread.set(conversationId, (groupUnread.get(conversationId) || 0) + 1);
    }
  });

  conversations.forEach((conversation) => {
    const participants = conversation.participants.filter((participant) => participant.status === 'approved');
    const conversationId = conversation._id.toString();
    threads.set(`group:${conversationId}`, {
      id: conversationId,
      type: 'group',
      name: conversation.name,
      participants: participants.map(({ _id, name, role }) => ({ id: _id.toString(), name, role })),
      students: conversation.students.map(({ _id, name, className }) => ({
        id: _id.toString(),
        name,
        className,
      })),
      lastMessage: latestGroupMessages.get(conversationId) || null,
      unread: groupUnread.get(conversationId) || 0,
      updatedAt: conversation.updatedAt,
    });
  });

  res.json({ threads: Array.from(threads.values()).sort((left, right) => {
    const leftDate = left.lastMessage ? new Date(left.lastMessage.createdAt).getTime() : 0;
    const rightDate = right.lastMessage ? new Date(right.lastMessage.createdAt).getTime() : 0;
    return rightDate - leftDate;
  }) });
};

// POST /api/messages/groups
exports.createGroup = async (req, res) => {
  if (req.user.role !== 'teacher' || req.user.status !== 'approved') {
    return res.status(403).json({ message: 'Only teachers can start family group conversations.' });
  }
  if (!validContent(req.body.content)) return messageError(res);

  const studentIds = Array.isArray(req.body.students) ? [...new Set(req.body.students)] : [];
  if (!studentIds.length || studentIds.length > 100
      || studentIds.some((studentId) => !mongoose.isObjectIdOrHexString(studentId))) {
    return res.status(400).json({ message: 'Choose between 1 and 100 valid assigned students.' });
  }

  const students = await Student.find({
    _id: { $in: studentIds },
    teacher: req.user._id,
    status: 'active',
  }).populate({ path: 'parent', select: 'name role status', match: { role: 'parent', status: 'approved' } });
  if (students.length !== studentIds.length) {
    return res.status(403).json({ message: 'Family groups can only include students actively assigned to you.' });
  }
  if (students.some((student) => !student.parent)) {
    return res.status(400).json({ message: 'Every selected student needs an approved parent account to join the family group.' });
  }

  const parentIds = [...new Set(students.map((student) => student.parent._id.toString()))];
  if (!parentIds.length) {
    return res.status(400).json({ message: 'No approved parent accounts are linked to the selected students.' });
  }

  const submittedName = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (submittedName.length > 80) {
    return res.status(400).json({ message: 'Group names must be 80 characters or fewer.' });
  }
  const classNames = [...new Set(students.map((student) => student.className).filter(Boolean))];
  const defaultName = students.length === 1
    ? `${students[0].name}'s family`
    : (classNames.length === 1 ? `${classNames[0]} families` : 'Family group');
  const name = submittedName || defaultName;

  try {
    const conversation = await Conversation.create({
      name: name.slice(0, 80),
      participants: [req.user._id, ...parentIds],
      students: students.map((student) => student._id),
      createdBy: req.user._id,
    });
    try {
      await Message.create({
        sender: req.user._id,
        conversation: conversation._id,
        content: req.body.content.trim(),
        readBy: [req.user._id],
      });
    } catch (err) {
      await Conversation.deleteOne({ _id: conversation._id });
      throw err;
    }

    res.status(201).json({ conversation });
  } catch (err) {
    res.status(500).json({ message: 'Could not create the family group.', error: err.message });
  }
};

// GET /api/messages/groups/:groupId
exports.getGroup = async (req, res) => {
  if (!['teacher', 'parent'].includes(req.user.role) || req.user.status !== 'approved') {
    return res.status(403).json({ message: 'Only approved teachers and parents can access family groups.' });
  }
  if (!mongoose.isObjectIdOrHexString(req.params.groupId)) {
    return res.status(404).json({ message: 'Conversation not found.' });
  }
  const conversation = await Conversation.findOne({
    _id: req.params.groupId,
    participants: req.user._id,
  })
    .populate({ path: 'participants', select: 'name role status' })
    .populate('students', 'name className');
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

  const messages = await Message.find({ conversation: conversation._id })
    .populate('sender', 'name role avatar')
    .sort({ createdAt: 1 });
  await Message.updateMany(
    { conversation: conversation._id, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id } },
    { $addToSet: { readBy: req.user._id } }
  );

  res.json({ conversation, messages });
};

// POST /api/messages/groups/:groupId/messages
exports.sendGroupMessage = async (req, res) => {
  if (!['teacher', 'parent'].includes(req.user.role) || req.user.status !== 'approved') {
    return res.status(403).json({ message: 'Only approved teachers and parents can send family group messages.' });
  }
  if (!validContent(req.body.content)) return messageError(res);
  if (!mongoose.isObjectIdOrHexString(req.params.groupId)) {
    return res.status(404).json({ message: 'Conversation not found.' });
  }
  const conversation = await Conversation.findOne({
    _id: req.params.groupId,
    participants: req.user._id,
  }).select('_id');
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

  const message = await Message.create({
    sender: req.user._id,
    conversation: conversation._id,
    content: req.body.content.trim(),
    readBy: [req.user._id],
  });
  await Conversation.updateOne({ _id: conversation._id }, { $set: { updatedAt: new Date() } });
  await message.populate('sender', 'name role avatar');
  res.status(201).json({ message });
};
