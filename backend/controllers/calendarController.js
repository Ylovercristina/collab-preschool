const Event = require('../models/Event');
const User = require('../models/User');
const calendar = require('../services/googleCalendar');
const logActivity = require('../utils/logActivity');

const CALENDAR_ID_PATTERN = /^[^\s<>"'`]{1,255}$/;

function adminEventsUrl(result) {
  const url = new URL('/frontend/pages/dashboard-admin.html', process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500');
  url.searchParams.set('panel', 'events');
  url.searchParams.set('googleCalendar', result);
  return url.toString();
}

// GET /api/calendar/google/status
exports.status = async (req, res) => {
  try {
    res.json({ status: await calendar.getStatus() });
  } catch (err) {
    console.error('[calendar] Status failed:', err.message);
    res.status(500).json({ message: 'Could not load Google Calendar status.' });
  }
};

// POST /api/calendar/google/connect
exports.connect = async (req, res) => {
  const configError = calendar.configurationError();
  if (configError) return res.status(400).json({ message: `Google Calendar is not set up. ${configError}` });
  try {
    res.json({ authorizationUrl: await calendar.createAuthorizationUrl(req.user._id) });
  } catch (err) {
    console.error('[calendar] Could not start Google connection:', err.message);
    res.status(500).json({ message: 'Could not start the Google Calendar connection.' });
  }
};

// GET /api/calendar/google/callback (Google redirects the admin's browser here)
exports.callback = async (req, res) => {
  const userId = await calendar.consumeState(req.query.state).catch(() => null);
  if (!userId) return res.redirect(adminEventsUrl('invalid-state'));
  if (req.query.error) return res.redirect(adminEventsUrl(req.query.error === 'access_denied' ? 'cancelled' : 'failed'));
  if (typeof req.query.code !== 'string') return res.redirect(adminEventsUrl('failed'));
  try {
    const admin = await User.findById(userId);
    if (!admin || admin.role !== 'admin' || admin.status === 'archived') return res.redirect(adminEventsUrl('forbidden'));
    await calendar.completeConnection(req.query.code, admin._id);
    await logActivity(admin._id, 'google-calendar-connected', 'Google Calendar');
    return res.redirect(adminEventsUrl('connected'));
  } catch (err) {
    console.error('[calendar] Google connection failed:', err.message);
    const result = err instanceof calendar.CalendarSyncError && /permission/i.test(err.message) ? 'missing-scope' : 'failed';
    return res.redirect(adminEventsUrl(result));
  }
};

// PATCH /api/calendar/google/settings
exports.updateSettings = async (req, res) => {
  const calendarId = String(req.body.calendarId || '').trim() || 'primary';
  if (!CALENDAR_ID_PATTERN.test(calendarId)) return res.status(400).json({ message: 'Enter a valid Google Calendar ID, or "primary".' });
  try {
    const integration = await calendar.getIntegration();
    integration.calendarId = calendarId;
    await integration.save();
    await logActivity(req.user._id, 'google-calendar-settings', calendarId);
    res.json({ status: await calendar.getStatus() });
  } catch (err) {
    console.error('[calendar] Settings update failed:', err.message);
    res.status(500).json({ message: 'Could not save Google Calendar settings.' });
  }
};

// POST /api/calendar/google/sync (sync every published event and retry failed removals)
exports.syncAll = async (req, res) => {
  try {
    const summary = await calendar.syncAll();
    res.json({ summary, status: await calendar.getStatus() });
  } catch (err) {
    const message = err instanceof calendar.CalendarSyncError ? err.message : 'Could not sync with Google Calendar.';
    if (!(err instanceof calendar.CalendarSyncError)) console.error('[calendar] Sync all failed:', err.message);
    res.status(err instanceof calendar.CalendarSyncError ? 409 : 500).json({ message });
  }
};

// POST /api/calendar/google/events/:id/sync
exports.syncEvent = async (req, res) => {
  try {
    const exists = await Event.exists({ _id: req.params.id });
    if (!exists) return res.status(404).json({ message: 'Event not found.' });
    const status = await calendar.getIntegration();
    if (!status.connected) return res.status(409).json({ message: 'Google Calendar is not connected.' });
    const googleCalendar = await calendar.syncEvent(req.params.id);
    res.json({ googleCalendar });
  } catch (err) {
    const notFound = err.name === 'CastError';
    if (!notFound) console.error('[calendar] Event sync failed:', err.message);
    res.status(notFound ? 404 : 500).json({ message: notFound ? 'Event not found.' : 'Could not sync this event.' });
  }
};

// DELETE /api/calendar/google/connection
exports.disconnect = async (req, res) => {
  try {
    await calendar.disconnect();
    await logActivity(req.user._id, 'google-calendar-disconnected', 'Google Calendar');
    res.json({ status: await calendar.getStatus(), message: 'Google Calendar disconnected. Events already in Google Calendar were not deleted.' });
  } catch (err) {
    console.error('[calendar] Disconnect failed:', err.message);
    res.status(500).json({ message: 'Could not disconnect Google Calendar.' });
  }
};
