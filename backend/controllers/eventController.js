const Event = require('../models/Event');
const logActivity = require('../utils/logActivity');

// GET /api/events
exports.listEvents = async (req, res) => {
  const filter = {};
  if (req.user.role === 'parent') filter.audience = { $in: ['all', 'parents'] };
  if (req.user.role === 'teacher') filter.audience = { $in: ['all', 'teachers'] };
  const events = await Event.find(filter).sort({ date: 1 });
  res.json({ events });
};

// POST /api/events   (admin creates; teacher can also post class/parent notices)
exports.createEvent = async (req, res) => {
  try {
    const { title, description, date, audience } = req.body;
    const event = await Event.create({ title, description, date, audience, createdBy: req.user._id });
    await logActivity(req.user._id, 'event-created', title);
    res.status(201).json({ event });
  } catch (err) {
    res.status(500).json({ message: 'Could not create event.', error: err.message });
  }
};

// PATCH /api/events/:id
exports.updateEvent = async (req, res) => {
  const allowed = ['title', 'description', 'date', 'audience'];
  const update = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  const event = await Event.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  res.json({ event });
};

// DELETE /api/events/:id
exports.deleteEvent = async (req, res) => {
  const event = await Event.findByIdAndDelete(req.params.id);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  res.json({ message: 'Event removed.' });
};
