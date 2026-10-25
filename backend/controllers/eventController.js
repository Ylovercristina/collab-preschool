const Event = require('../models/Event');
const EmailLog = require('../models/EmailLog');
const Notification = require('../models/Notification');
const Student = require('../models/Student');
const User = require('../models/User');
const { queueEmailDelivery } = require('../services/emailDelivery');
const logActivity = require('../utils/logActivity');
const { eventMapsUrl } = require('../utils/eventMaps');
const { addToGoogleCalendarUrl, queueEventRemoval, queueEventSync } = require('../services/googleCalendar');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

// Returns a clean location, null when none was chosen, or false when it is invalid.
function normalizeLocation(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (value.lat === '' || value.lng === '' || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  const placeId = String(value.placeId || '').trim();
  return {
    address: String(value.address || '').trim().slice(0, 300),
    lat,
    lng,
    placeId: /^[\w-]{1,512}$/.test(placeId) ? placeId : '',
  };
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
  const location = normalizeLocation(body.location);
  if (location === false) return { error: 'The selected map location is invalid. Choose the venue on the map again.' };
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
      location,
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
  const mapsUrl = eventMapsUrl(event);
  const details = `${event.title}\n${event.description}\nDate: ${date}\nTime: ${event.time}\nVenue: ${event.venue}${mapsUrl ? `\nMap: ${mapsUrl}` : ''}\nSign in to view your dashboard: ${url}`;
  return {
    subject: `School event: ${event.title}`,
    text: details,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#25332d"><h2>${escapeHtml(event.title)}</h2><p>${escapeHtml(event.description).replace(/\r?\n/g, '<br>')}</p><p><strong>Date:</strong> ${escapeHtml(date)}<br><strong>Time:</strong> ${escapeHtml(event.time)}<br><strong>Venue:</strong> ${escapeHtml(event.venue)}${mapsUrl ? ` (<a href="${escapeHtml(mapsUrl)}">View on Google Maps</a>)` : ''}</p><p><a href="${escapeHtml(url)}">Sign in to view your dashboard</a></p></div>`,
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
  const alreadyNotified = event.emailRecipientCount > 0;
  event.emailRecipientCount = recipients.length;
  event.publicationStatus = 'published';
  event.approvalStatus = 'approved';
  event.approvedAt = new Date();
  if (event.reviewStatus === 'publishing') event.reviewStatus = 'approved';
  await event.save();
  // Only queue emails if they haven't been sent yet
  if (recipients.length && !alreadyNotified) {
    queueEmailDelivery({ ...eventEmail(event), parents: recipients, type: 'event', eventId: event._id });
  }
  queueEventSync(event._id);
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
      {
        $or: [
          { approvalStatus: 'approved' },
          { publicationStatus: 'published' },
        ],
      },
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
  const query = Event.find(filter).populate('createdBy', 'name role').sort({ date: 1 });
  if (req.user.role === 'admin') query.select('+googleCalendar');
  const events = (await query).map((event) => {
    const value = event.toJSON();
    if (event.publicationStatus === 'published' && event.approvalStatus === 'approved') {
      value.addToGoogleCalendarUrl = addToGoogleCalendarUrl(event);
    }
    return value;
  });
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
      values.approvalStatus = 'pending';
    } else if (values.publicationStatus === 'published') {
      values.reviewStatus = 'approved';
      values.reviewedBy = req.user._id;
      values.reviewedAt = new Date();
      values.approvalStatus = 'approved';
      values.approvedAt = new Date();
      values.approvedBy = req.user._id;
    } else if (values.publicationStatus === 'pending') {
      values.reviewStatus = 'pending';
      values.approvalStatus = 'pending';
    }
    const event = await Event.create(values);
    if (event.approvalStatus === 'approved') await publishEvent(event);
    await logActivity(req.user._id, 'event-created', event.title);
    res.status(201).json({
      event,
      emailSummary: await getEmailSummary(event),
      message: event.approvalStatus === 'pending' ? 'Event submitted for admin approval.' : undefined,
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
      location: req.body.location === undefined ? event.location : req.body.location,
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
      validated.value.approvalStatus = 'pending';
    }
    const previousApproval = event.approvalStatus;
    Object.assign(event, validated.value);
    await event.save();
    if (previousApproval !== 'approved' && event.approvalStatus === 'approved') await publishEvent(event);
    else queueEventSync(event._id);
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

    event.approvalStatus = 'approved';
    event.approvedAt = new Date();
    event.approvedBy = req.user._id;
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

// PUT /api/events/:id/approve (admin approves a pending event)
exports.approveEvent = async (req, res) => {
  try {
    const event = await Event.findOne({
      _id: req.params.id,
      publicationStatus: 'pending',
    });
    if (!event) {
      const existing = await Event.findById(req.params.id);
      if (!existing) return res.status(404).json({ message: 'Event not found.' });
      const isApproved = existing.approvalStatus === 'approved'
        || existing.publicationStatus === 'published';
      if (isApproved) {
        return res.status(409).json({ message: 'This event has already been approved.' });
      }
      return res.status(409).json({ message: 'This event is not waiting for approval.' });
    }

    event.approvalStatus = 'approved';
    event.approvedAt = new Date();
    event.approvedBy = req.user._id;
    event.publicationStatus = 'published';
    event.reviewStatus = 'approved';
    event.reviewedBy = req.user._id;
    event.reviewedAt = new Date();
    await event.save();

    try {
      await publishEvent(event);
      await logActivity(req.user._id, 'event-approved', event.title);
      return res.json({
        event,
        emailSummary: await getEmailSummary(event),
        message: 'Event approved and published.',
      });
    } catch (error) {
      await Event.findOneAndUpdate(
        { _id: event._id },
        { $set: { approvalStatus: 'pending', approvedAt: null, approvedBy: null } }
      );
      console.error('[events] Could not publish approved event:', error.message);
      return res.status(500).json({ message: 'Approval was not completed. The event remains pending and can be retried.' });
    }
  } catch (err) {
    console.error('[events] Could not approve event:', err.message);
    return res.status(500).json({ message: 'Could not approve event.' });
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
    const event = await Event.findOneAndDelete(filter).select('+googleCalendar');
    if (!event) {
      if (req.user.role === 'teacher') {
        return res.status(403).json({ message: 'Teachers may remove only their own events while they are pending admin approval.' });
      }
      return res.status(404).json({ message: 'Event not found.' });
    }
    queueEventRemoval(event);
    await logActivity(req.user._id, 'event-removed', event.title);
    return res.json({ message: 'Event removed.' });
  } catch (err) {
    const status = err.name === 'CastError' ? 404 : 500;
    return res.status(status).json({ message: status === 404 ? 'Event not found.' : 'Could not remove event.' });
  }
};
