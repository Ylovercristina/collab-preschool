const Event = require('../models/Event');
const EmailLog = require('../models/EmailLog');
const Notification = require('../models/Notification');
const Student = require('../models/Student');
const User = require('../models/User');
const { queueEmailDelivery } = require('../services/emailDelivery');
const logActivity = require('../utils/logActivity');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function validateEvent(body) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const dateValue = String(body.date || '').trim();
  const time = String(body.time || '').trim();
  const venue = String(body.venue || '').trim();
  const targetType = body.targetType === 'classes' ? 'classes' : 'all';
  const audience = body.audience || 'all';
  const targetClasses = Array.isArray(body.targetClasses)
    ? [...new Set(body.targetClasses.map((item) => String(item).trim()).filter(Boolean))]
    : [];

  if (!title || !description || !dateValue || !time || !venue) {
    return { error: 'Title, description, date, time and venue are required.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || Number.isNaN(Date.parse(`${dateValue}T00:00:00Z`))) {
    return { error: 'Enter a valid event date.' };
  }
  if (dateValue < new Date().toISOString().slice(0, 10)) return { error: 'Event date cannot be in the past.' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'Enter a valid event time.' };
  if (targetType === 'classes' && !targetClasses.length) return { error: 'Select at least one class or choose all recipients.' };
  if (!['all', 'parents', 'teachers'].includes(audience)) return { error: 'Select a valid event audience.' };
  if (!['draft', 'pending', 'published'].includes(body.publicationStatus || 'published')) {
    return { error: 'Publication status must be draft, pending, or published.' };
  }
  return {
    value: {
      title,
      description,
      date: new Date(`${dateValue}T00:00:00.000Z`),
      time,
      venue,
      targetType,
      targetClasses: targetType === 'classes' ? targetClasses : [],
      publicationStatus: body.publicationStatus || 'published',
      audience,
    },
  };
}

async function getEventRecipients(event) {
  const recipients = [];
  const targetClasses = event.targetType === 'classes' ? event.targetClasses : [];
  const hasClassTarget = targetClasses.length > 0;

  if (event.audience !== 'teachers') {
    const parentIds = hasClassTarget
      ? await Student.distinct('parent', {
        parent: { $ne: null },
        className: { $in: targetClasses },
        status: 'active',
      })
      : null;
    const parents = await User.find({
      role: 'parent',
      status: 'approved',
      ...(parentIds ? { _id: { $in: parentIds } } : {}),
    }).select('name email role status emailVerified emailVerifiedBy');
    recipients.push(...parents);
  }

  if (event.audience !== 'parents') {
    let teacherIds;
    if (hasClassTarget) {
      const assignedTeacherIds = await Student.distinct('teacher', {
        teacher: { $ne: null },
        className: { $in: targetClasses },
        status: 'active',
      });
      const classTeachers = await User.distinct('_id', {
        role: 'teacher',
        assignedClass: { $in: targetClasses },
      });
      teacherIds = [...new Set([...assignedTeacherIds, ...classTeachers].map(String))];
    }
    const teachers = await User.find({
      role: 'teacher',
      status: 'approved',
      ...(teacherIds ? { _id: { $in: teacherIds } } : {}),
    }).select('name email role status emailVerified emailVerifiedBy');
    recipients.push(...teachers);
  }

  return [...new Map(recipients.map((recipient) => [String(recipient._id), recipient])).values()];
}

function eventEmail(event) {
  const date = new Date(event.date).toLocaleDateString();
  const url = `${process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500'}/frontend/pages/login.html`;
  const details = `${event.title}\n${event.description}\nDate: ${date}\nTime: ${event.time}\nVenue: ${event.venue}\nSign in to view your dashboard: ${url}`;
  return {
    subject: `School event: ${event.title}`,
    text: details,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#25332d"><h2>${escapeHtml(event.title)}</h2><p>${escapeHtml(event.description).replace(/\r?\n/g, '<br>')}</p><p><strong>Date:</strong> ${escapeHtml(date)}<br><strong>Time:</strong> ${escapeHtml(event.time)}<br><strong>Venue:</strong> ${escapeHtml(event.venue)}</p><p><a href="${escapeHtml(url)}">Sign in to view your dashboard</a></p></div>`,
  };
}

async function publishEvent(event) {
  const recipients = await getEventRecipients(event);
  const message = `${event.description} Date: ${new Date(event.date).toLocaleDateString()}, ${event.time}, ${event.venue}.`;
  if (recipients.length) {
    await Notification.bulkWrite(recipients.map((recipient) => ({
      updateOne: {
        filter: { parent: recipient._id, event: event._id, type: 'event' },
        update: { $setOnInsert: { parent: recipient._id, event: event._id, type: 'event', priority: 1, title: event.title, message } },
        upsert: true,
      },
    })));
  }
  event.emailRecipientCount = recipients.length;
  event.publicationStatus = 'published';
  if (event.reviewStatus === 'publishing') event.reviewStatus = 'approved';
  await event.save();
  if (recipients.length) {
    queueEmailDelivery({ ...eventEmail(event), parents: recipients, type: 'event', eventId: event._id });
  }
  return recipients.length;
}

async function getEmailSummary(event) {
  const logs = await EmailLog.find({ event: event._id }).select('status errorMessage');
  const summary = {
    sent: logs.filter((log) => log.status === 'sent').length,
    skipped: logs.filter((log) => log.status === 'skipped').length,
    unverified: logs.filter((log) => log.status === 'skipped' && log.errorMessage.includes('not verified')).length,
    failed: logs.filter((log) => log.status === 'failed').length,
    expected: event.emailRecipientCount || 0,
  };
  summary.complete = logs.length >= summary.expected;
  return summary;
}

// GET /api/events
exports.listEvents = async (req, res) => {
  const filter = {};
  if (req.user.role === 'parent') {
    const classNames = await Student.distinct('className', { parent: req.user._id, status: 'active' });
    filter.$and = [
      { audience: { $in: ['all', 'parents'] } },
      { $or: [{ publicationStatus: 'published' }, { publicationStatus: { $exists: false } }] },
      { $or: [{ targetType: 'all' }, { targetType: { $exists: false } }, { targetClasses: { $in: classNames } }] },
    ];
  } else if (req.user.role === 'teacher') {
    const teacherClasses = await Student.distinct('className', {
      teacher: req.user._id,
      status: 'active',
    });
    if (req.user.assignedClass) teacherClasses.push(req.user.assignedClass);
    filter.$and = [
      {
        $or: [
          { audience: { $in: ['all', 'teachers'] } },
          { createdBy: req.user._id },
        ],
      },
      {
        $or: [
          { targetType: { $ne: 'classes' } },
          { targetClasses: { $in: [...new Set(teacherClasses)] } },
          { createdBy: req.user._id },
        ],
      },
    ];
  }
  const events = await Event.find(filter).populate('createdBy', 'name role').sort({ date: 1 });
  res.json({ events });
};

// POST /api/events
exports.createEvent = async (req, res) => {
  try {
    const validated = validateEvent(req.body);
    if (validated.error) return res.status(400).json({ message: validated.error });
    const values = { ...validated.value, createdBy: req.user._id };
    if (req.user.role === 'teacher') {
      if (values.publicationStatus === 'published') values.publicationStatus = 'pending';
      values.reviewStatus = values.publicationStatus === 'pending' ? 'pending' : 'not-required';
      values.reviewedBy = null;
      values.reviewedAt = null;
      values.reviewNotes = '';
    } else if (values.publicationStatus === 'published') {
      values.reviewStatus = 'approved';
      values.reviewedBy = req.user._id;
      values.reviewedAt = new Date();
    } else if (values.publicationStatus === 'pending') {
      values.reviewStatus = 'pending';
    }
    const event = await Event.create(values);
    if (event.publicationStatus === 'published') await publishEvent(event);
    await logActivity(req.user._id, 'event-created', event.title);
    res.status(201).json({
      event,
      emailSummary: await getEmailSummary(event),
      message: event.publicationStatus === 'pending' ? 'Event submitted for admin approval.' : undefined,
    });
  } catch (err) {
    const status = err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500;
    res.status(status).json({ message: status === 400 ? err.message : 'Could not create event.' });
  }
};

// PATCH /api/events/:id
exports.updateEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found.' });
    if (req.user.role !== 'admin' && String(event.createdBy) !== String(req.user._id)) {
      return res.status(403).json({ message: 'You can only update events you created.' });
    }
    if (req.user.role === 'teacher' && event.publicationStatus === 'published') {
      return res.status(403).json({ message: 'Published events can only be changed by an admin.' });
    }
    if (req.user.role === 'admin' && event.publicationStatus === 'pending'
      && req.body.publicationStatus === 'published') {
      return res.status(400).json({ message: 'Review pending events with the Admin approval action.' });
    }
    const previousStatus = event.publicationStatus || 'published';
    const validated = validateEvent({
      title: req.body.title === undefined ? event.title : req.body.title,
      description: req.body.description === undefined ? event.description : req.body.description,
      date: req.body.date === undefined ? new Date(event.date).toISOString().slice(0, 10) : req.body.date,
      time: req.body.time === undefined ? (event.time || '09:00') : req.body.time,
      venue: req.body.venue === undefined ? (event.venue || 'School') : req.body.venue,
      targetType: req.body.targetType === undefined ? (event.targetType || 'all') : req.body.targetType,
      targetClasses: req.body.targetClasses === undefined ? event.targetClasses : req.body.targetClasses,
      publicationStatus: req.body.publicationStatus === undefined
        ? (req.user.role === 'teacher' && previousStatus === 'rejected' ? 'pending' : previousStatus)
        : req.body.publicationStatus,
      audience: req.body.audience === undefined ? (event.audience || 'parents') : req.body.audience,
    });
    if (validated.error) return res.status(400).json({ message: validated.error });
    if (req.user.role === 'teacher') {
      if (previousStatus === 'rejected' || validated.value.publicationStatus === 'published') {
        validated.value.publicationStatus = 'pending';
      }
      validated.value.reviewStatus = validated.value.publicationStatus === 'pending' ? 'pending' : 'not-required';
      validated.value.reviewedBy = null;
      validated.value.reviewedAt = null;
      validated.value.reviewNotes = '';
    }
    Object.assign(event, validated.value);
    await event.save();
    if (previousStatus !== 'published' && event.publicationStatus === 'published') await publishEvent(event);
    res.json({ event, emailSummary: await getEmailSummary(event) });
  } catch (err) {
    const status = err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500;
    res.status(status).json({ message: status === 400 ? err.message : 'Could not update event.' });
  }
};

// PATCH /api/events/:id/review (admin approves or rejects a teacher submission)
exports.reviewEvent = async (req, res) => {
  const decision = String(req.body.decision || '').trim();
  const reviewNotes = String(req.body.reviewNotes || '').trim();
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ message: 'Choose approve or reject.' });
  }
  try {
    const event = await Event.findOneAndUpdate(
      { _id: req.params.id, publicationStatus: 'pending', reviewStatus: 'pending' },
      {
        $set: {
          reviewStatus: decision === 'approved' ? 'publishing' : 'rejected',
          publicationStatus: decision === 'rejected' ? 'rejected' : 'pending',
          reviewedBy: req.user._id,
          reviewedAt: new Date(),
          reviewNotes,
        },
      },
      { new: true, runValidators: true }
    );
    if (!event) return res.status(409).json({ message: 'This event is no longer waiting for review.' });

    if (decision === 'rejected') {
      await logActivity(req.user._id, 'event-rejected', event.title);
      return res.json({ event, message: 'Event rejected. Parents were not notified.' });
    }

    try {
      await publishEvent(event);
      await logActivity(req.user._id, 'event-approved', event.title);
      return res.json({ event, emailSummary: await getEmailSummary(event), message: 'Event approved and published.' });
    } catch (error) {
      await Event.findOneAndUpdate(
        { _id: event._id, publicationStatus: 'pending', reviewStatus: 'publishing' },
        { $set: { reviewStatus: 'pending', reviewedBy: null, reviewedAt: null } }
      );
      console.error('[events] Could not publish approved event:', error.message);
      return res.status(500).json({ message: 'Approval was not completed. The event remains pending and can be retried.' });
    }
  } catch (err) {
    console.error('[events] Could not review event:', err.message);
    return res.status(500).json({ message: 'Could not review event.' });
  }
};

// GET /api/events/:id/email-summary
exports.emailSummary = async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  if (req.user.role !== 'admin' && String(event.createdBy) !== String(req.user._id)) {
    return res.status(403).json({ message: 'You cannot view this delivery summary.' });
  }
  res.json({ emailSummary: await getEmailSummary(event) });
};

// DELETE /api/events/:id
exports.deleteEvent = async (req, res) => {
  try {
    const filter = { _id: req.params.id };
    if (req.user.role === 'teacher') {
      filter.createdBy = req.user._id;
      filter.publicationStatus = 'pending';
      filter.reviewStatus = 'pending';
    }
    const event = await Event.findOneAndDelete(filter);
    if (!event) {
      if (req.user.role === 'teacher') {
        return res.status(403).json({ message: 'Teachers may remove only their own events while they are pending admin approval.' });
      }
      return res.status(404).json({ message: 'Event not found.' });
    }
    await logActivity(req.user._id, 'event-removed', event.title);
    return res.json({ message: 'Event removed.' });
  } catch (err) {
    const status = err.name === 'CastError' ? 404 : 500;
    return res.status(status).json({ message: status === 404 ? 'Event not found.' : 'Could not remove event.' });
  }
};
