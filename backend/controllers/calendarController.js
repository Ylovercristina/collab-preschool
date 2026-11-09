const Event = require('../models/Event');
const User = require('../models/User');
const calendar = require('../services/googleCalendar');
const googleDrive = require('../services/googleDrive');
const { isEventVisibleToUser } = require('../services/eventVisibility');
const logActivity = require('../utils/logActivity');

const CALENDAR_ID_PATTERN = /^[^\s<>"'`]{1,255}$/;

function adminEventsUrl(result) {
  const url = new URL('/frontend/pages/dashboard-admin.html', process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500');
  url.searchParams.set('panel', 'events');
  url.searchParams.set('googleCalendar', result);
  return url.toString();
}

function userEventsUrl(role, result) {
  const url = new URL(`/frontend/pages/dashboard-${role}.html`, process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500');
  url.searchParams.set('panel', 'events');
  url.searchParams.set('personalGoogleCalendar', result);
  return url.toString();
}

function googleDrivePopupResponse(res, result) {
  const origin = new URL(process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5500').origin;
  const message = JSON.stringify({ source: 'play-is-school', type: 'google-drive-oauth', result }).replace(/</g, '\\u003c');
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Google Drive</title></head><body><p>Returning to Academic Progress…</p><script>if (window.opener) { window.opener.postMessage(${message}, ${JSON.stringify(origin)}); window.opener.focus(); } window.close();</script></body></html>`);
}

async function handleGoogleDriveCallback(req, res) {
  const driveState = await googleDrive.consumeOAuthState(req.query.state);
  if (!driveState) return false;
  const user = await User.findById(driveState.userId);
  if (!user || user.role !== 'teacher' || user.status === 'archived') {
    googleDrivePopupResponse(res, 'forbidden');
    return true;
  }
  if (req.query.error) {
    googleDrivePopupResponse(res, req.query.error === 'access_denied' ? 'cancelled' : 'failed');
    return true;
  }
  if (typeof req.query.code !== 'string') {
    googleDrivePopupResponse(res, 'failed');
    return true;
  }
  try {
    await googleDrive.completeConnection(req.query.code, user._id, driveState.clientSelectionId);
    await logActivity(user._id, 'google-drive-connected', 'Academic progress photos');
    googleDrivePopupResponse(res, 'connected');
  } catch (err) {
    console.error('[progress] Google Drive connection failed:', err.message);
    googleDrivePopupResponse(res, /permission/i.test(err.message) ? 'missing-scope' : 'failed');
  }
  return true;
}

function googleCalendarFailureResult(error) {
  const responseError = error && error.response && error.response.data && error.response.data.error;
  const detail = `${error && error.code || ''} ${responseError || ''} ${error && error.message || error || ''}`.toLowerCase();
  if (/permission/.test(detail)) return 'missing-scope';
  if (/refresh token|offline access/.test(detail)) return 'missing-refresh';
  if (/redirect_uri_mismatch|redirect uri mismatch/.test(detail)) return 'redirect-mismatch';
  if (/invalid_client|unauthorized_client/.test(detail)) return 'invalid-client';
  if (/invalid_grant/.test(detail)) return 'invalid-grant';
  return 'failed';
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
  if (await handleGoogleDriveCallback(req, res)) return;

  const personalState = await calendar.consumePersonalState(req.query.state).catch(() => null);
  if (personalState) {
    const user = await User.findById(personalState.userId);
    if (!user || user.status === 'archived') return res.redirect(userEventsUrl(user ? user.role : 'parent', 'forbidden'));
    if (req.query.error) return res.redirect(userEventsUrl(user.role, req.query.error === 'access_denied' ? 'cancelled' : 'failed'));
    if (typeof req.query.code !== 'string') return res.redirect(userEventsUrl(user.role, 'failed'));
    try {
      if (!personalState.shareCalendarWithSchool) return res.redirect(userEventsUrl(user.role, 'consent-required'));
      await calendar.completePersonalConnection(req.query.code, user._id, personalState.clientSelectionId, personalState.shareCalendarWithSchool);
      await logActivity(user._id, 'personal-google-calendar-connected', 'Google Calendar');
      return res.redirect(userEventsUrl(user.role, 'connected'));
    } catch (err) {
      console.error('[calendar] Personal Google connection failed:', err.message);
      const result = err instanceof calendar.CalendarSyncError && /permission/i.test(err.message)
        ? 'missing-scope'
        : 'failed';
      return res.redirect(userEventsUrl(user.role, result));
    }
  }

  const state = await calendar.consumeState(req.query.state).catch(() => null);
  if (!state) return res.redirect(adminEventsUrl('invalid-state'));
  if (req.query.error) {
    const result = req.query.error === 'access_denied'
      ? 'cancelled'
      : googleCalendarFailureResult(req.query.error);
    return res.redirect(adminEventsUrl(result));
  }
  if (typeof req.query.code !== 'string') return res.redirect(adminEventsUrl('failed'));
  try {
    const admin = await User.findById(state.userId);
    if (!admin || admin.role !== 'admin' || admin.status === 'archived') return res.redirect(adminEventsUrl('forbidden'));
    await calendar.completeConnection(req.query.code, admin._id, state.clientSelectionId);
    await logActivity(admin._id, 'google-calendar-connected', 'Google Calendar');
    return res.redirect(adminEventsUrl('connected'));
  } catch (err) {
    console.error('[calendar] Google connection failed:', err.message);
    return res.redirect(adminEventsUrl(googleCalendarFailureResult(err)));
  }
};

exports.driveCallback = async (req, res) => {
  try {
    if (await handleGoogleDriveCallback(req, res)) return;
    googleDrivePopupResponse(res, 'invalid-state');
  } catch (err) {
    console.error('[progress] Google Drive callback failed:', err.message);
    googleDrivePopupResponse(res, 'failed');
  }
};

// GET /api/calendar/google/personal/status
exports.personalStatus = async (req, res) => {
  try {
    res.json({ status: await calendar.getPersonalCalendarStatus(req.user._id) });
  } catch (err) {
    console.error('[calendar] Personal status failed:', err.message);
    res.status(500).json({ message: 'Could not load your Google Calendar connection.' });
  }
};

// POST /api/calendar/google/personal/connect
exports.personalConnect = async (req, res) => {
  const configError = calendar.configurationError();
  if (configError) return res.status(400).json({ message: `Google Calendar is not set up. ${configError}` });
  try {
    const authorizationUrl = await calendar.createPersonalAuthorizationUrl(
      req.user._id,
      (req.body || {}).shareCalendarWithSchool
    );
    res.json({ authorizationUrl });
  } catch (err) {
    if (err instanceof calendar.CalendarSyncError) return res.status(400).json({ message: err.message });
    console.error('[calendar] Could not start personal Google connection:', err.message);
    res.status(500).json({ message: 'Could not start your Google Calendar connection.' });
  }
};

// POST /api/calendar/google/personal/sync (import Google events and update selected school events)
exports.syncPersonalEvents = async (req, res) => {
  try {
    const summary = await calendar.syncPersonalUserEvents(req.user._id);
    res.json({ summary });
  } catch (err) {
    const status = err instanceof calendar.CalendarSyncError ? 409 : 500;
    if (status === 500) console.error('[calendar] Personal event sync failed:', err.message);
    res.status(status).json({ message: status === 409 ? err.message : 'Could not sync Google Calendar events.' });
  }
};

// POST /api/calendar/google/personal/events/:id
exports.addPersonalEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event || event.publicationStatus !== 'published' || event.approvalStatus !== 'approved') {
      return res.status(404).json({ message: 'Approved school event not found.' });
    }
    if (!await isEventVisibleToUser(event, req.user)) {
      return res.status(404).json({ message: 'Approved school event not found.' });
    }
    const personalGoogleCalendar = await calendar.addPersonalEvent(req.user._id, event);
    if (personalGoogleCalendar.status !== 'synced') {
      return res.status(502).json({
        message: personalGoogleCalendar.error || 'Could not add this event to your Google Calendar.',
        personalGoogleCalendar,
      });
    }
    return res.json({ personalGoogleCalendar, message: 'Event added to your Google Calendar.' });
  } catch (err) {
    const status = err.name === 'CastError' ? 404 : (err instanceof calendar.CalendarSyncError ? 409 : 500);
    if (status === 500) console.error('[calendar] Personal event add failed:', err.message);
    return res.status(status).json({
      message: status === 404 ? 'Approved school event not found.' : (status === 409 ? err.message : 'Could not add this event to your Google Calendar.'),
    });
  }
};

// DELETE /api/calendar/google/personal/events/:id
exports.removePersonalEvent = async (req, res) => {
  try {
    const personalGoogleCalendar = await calendar.removePersonalEvent(req.user._id, req.params.id);
    if (personalGoogleCalendar.status !== 'removed') {
      return res.status(502).json({
        message: personalGoogleCalendar.error || 'Could not remove this event from your Google Calendar.',
        personalGoogleCalendar,
      });
    }
    return res.json({ personalGoogleCalendar, message: 'Event removed from your Google Calendar.' });
  } catch (err) {
    const status = err.name === 'CastError' ? 404 : (err instanceof calendar.CalendarSyncError ? 409 : 500);
    if (status === 500) console.error('[calendar] Personal event removal failed:', err.message);
    return res.status(status).json({
      message: status === 404 ? 'Event not found.' : (status === 409 ? err.message : 'Could not remove this event from your Google Calendar.'),
    });
  }
};

// DELETE /api/calendar/google/personal/connection
exports.disconnectPersonal = async (req, res) => {
  try {
    await calendar.disconnectPersonalCalendar(req.user._id);
    await logActivity(req.user._id, 'personal-google-calendar-disconnected', 'Google Calendar');
    res.json({
      status: await calendar.getPersonalCalendarStatus(req.user._id),
      message: 'Google Calendar disconnected. Imported events were removed from the shared system calendar; events already added to Google were left unchanged.',
    });
  } catch (err) {
    console.error('[calendar] Personal disconnect failed:', err.message);
    res.status(500).json({ message: 'Could not disconnect your Google Calendar.' });
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
