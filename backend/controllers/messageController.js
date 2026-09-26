const Message = require('../models/Message');

// POST /api/messages
exports.sendMessage = async (req, res) => {
  try {
    const { receiver, student, content } = req.body;
    const message = await Message.create({ sender: req.user._id, receiver, student, content });
    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ message: 'Could not send message.', error: err.message });
  }
};

// GET /api/messages/thread/:userId   (conversation between me and userId)
exports.getThread = async (req, res) => {
  const messages = await Message.find({
    $or: [
      { sender: req.user._id, receiver: req.params.userId },
      { sender: req.params.userId, receiver: req.user._id },
    ],
  }).sort({ createdAt: 1 });

  await Message.updateMany(
    { sender: req.params.userId, receiver: req.user._id, read: false },
    { read: true }
  );

  res.json({ messages });
};

// GET /api/messages/inbox   (list of conversations with last message + unread count)
exports.getInbox = async (req, res) => {
  const messages = await Message.find({
    $or: [{ sender: req.user._id }, { receiver: req.user._id }],
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
