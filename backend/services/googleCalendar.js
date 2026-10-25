const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const CalendarIntegration = require('../models/CalendarIntegration');
const Event = require('../models/Event');
const { eventMapsUrl } = require('../utils/eventMaps');

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
// openid + email only identify which Google account is connected.
const CONNECT_SCOPES = ['openid', 'email', CALENDAR_SCOPE];
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const REQUEST_TIMEOUT_MS = 10000;
const STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIME_ZONE = 'Asia/Manila';
const DEFAULT_DURATION_MINUTES = 60;
const RECONNECT_MESSAGE = 'Google Calendar access expired or was revoked. An admin needs to reconnect Google Calendar.';

const syncQueues = new Map();

function schoolTimeZone() {
  const timeZone = String(process.env.SCHOOL_TIME_ZONE || '').trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch (err) {
    console.error(`[calendar] Invalid SCHOOL_TIME_ZONE "${timeZone}"; using ${DEFAULT_TIME_ZONE}.`);
    return DEFAULT_TIME_ZONE;
  }
}

function eventDurationMinutes() {
  const minutes = Number(process.env.GOOGLE_CALENDAR_EVENT_DURATION_MINUTES);
  return Number.isInteger(minutes) && minutes >= 15 && minutes <= 1440 ? minutes : DEFAULT_DURATION_MINUTES;
}

function configurationError() {
  const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALENDAR_CALLBACK_URL']
    .filter((name) => !String(process.env[name] || '').trim());
  if (!process.env.GOOGLE_TOKEN_ENCRYPTION_KEY && !process.env.JWT_SECRET) missing.push('GOOGLE_TOKEN_ENCRYPTION_KEY');
  return missing.length ? `Missing ${missing.join(', ')} in backend/.env.` : '';
}

function oauthClient() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALENDAR_CALLBACK_URL
  );
}

function tokenKey() {
  const secret = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY or JWT_SECRET is required to store Google tokens.');
  return crypto.createHash('sha256').update(`play-is-school:google-calendar:${secret}`).digest();
}

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
}

function decryptToken(value) {
  const [iv, tag, encrypted] = String(value || '').split('.').map((part) => Buffer.from(part, 'base64'));
  if (!iv || !tag || !encrypted) throw new Error('Stored Google token is unreadable.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function hashState(state) {
  return crypto.createHash('sha256').update(String(state)).digest('hex');
}

async function getIntegration(fields = '') {
  const query = CalendarIntegration.findOne({ key: 'google' });
  if (fields) query.select(fields);
  return (await query) || CalendarIntegration.create({ key: 'google' });
}

// Google accepts client-chosen IDs in base32hex (0-9, a-v); a fixed ID per school event prevents duplicates on retry.
function googleEventIdFor(eventId) {
  return `pis${String(eventId).toLowerCase()}`;
}

function belongsInGoogle(event) {
  return event.publicationStatus === 'published' && event.approvalStatus === 'approved';
}

function addMinutes(dateValue, time, minutes) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  // Wall-clock arithmetic only; Google applies the school time zone.
  const shifted = new Date(Date.UTC(year, month - 1, day, hour, minute + minutes));
  const pad = (value) => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:00`;
}

function eventTimes(event) {
  const dateValue = new Date(event.date).toISOString().slice(0, 10);
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(event.time || '') ? event.time : '09:00';
  return {
    start: addMinutes(dateValue, time, 0),
    end: addMinutes(dateValue, time, eventDurationMinutes()),
  };
}

function eventLocationText(event) {
  const address = event.location && event.location.address ? event.location.address : '';
  if (event.venue && address && !address.startsWith(event.venue)) return `${event.venue}, ${address}`;
  return address || event.venue || '';
}

function googleEventBody(event) {
  const timeZone = schoolTimeZone();
  const { start, end } = eventTimes(event);
  const mapsUrl = eventMapsUrl(event);
  const details = [
    event.description || '',
    event.venue ? `Venue: ${event.venue}` : '',
    mapsUrl ? `Map: ${mapsUrl}` : '',
    'Published from Play-is-School.',
  ].filter(Boolean).join('\n\n');
  return {
    summary: event.title,
    description: details,
    location: eventLocationText(event),
    start: { dateTime: start, timeZone },
    end: { dateTime: end, timeZone },
    status: 'confirmed',
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 24 * 60 }, { method: 'popup', minutes: 60 }],
    },
    extendedProperties: { private: { playIsSchoolEventId: String(event._id) } },
  };
}

// "Add to Google Calendar" link anyone can use for their own calendar; needs no API access.
function addToGoogleCalendarUrl(event) {
  const { start, end } = eventTimes(event);
  const compact = (value) => value.replace(/[-:]/g, '');
  const mapsUrl = eventMapsUrl(event);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title || 'School event',
    dates: `${compact(start)}/${compact(end)}`,
    ctz: schoolTimeZone(),
    details: [event.description || '', mapsUrl ? `Map: ${mapsUrl}` : ''].filter(Boolean).join('\n\n'),
    location: eventLocationText(event),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

class CalendarSyncError extends Error {
  constructor(message, { status = 0, reconnect = false } = {}) {
    super(message);
    this.status = status;
    this.reconnect = reconnect;
  }
}

function toSyncError(err) {
  if (err instanceof CalendarSyncError) return err;
  const status = Number(err.status || (err.response && err.response.status) || 0);
  const data = (err.response && err.response.data) || {};
  const oauthError = typeof data.error === 'string' ? data.error : '';
  const apiMessage = (data.error && data.error.message) || data.error_description || err.message || 'Unknown error';
  if (oauthError === 'invalid_grant' || /invalid_grant/.test(err.message || '') || status === 401) {
    return new CalendarSyncError(RECONNECT_MESSAGE, { status, reconnect: true });
  }
  if (status === 403) return new CalendarSyncError(`Google refused the request: ${apiMessage}`, { status });
  if (status === 404 || status === 410) return new CalendarSyncError('Google Calendar item was not found.', { status });
  if (status === 429 || status >= 500) return new CalendarSyncError('Google Calendar is busy or unavailable. Try again later.', { status });
  if (!status) return new CalendarSyncError('Could not reach Google Calendar. Check the server internet connection.');
  return new CalendarSyncError(`Google Calendar error (${status}): ${apiMessage}`, { status });
}

async function markReconnectNeeded() {
  await CalendarIntegration.updateOne({ key: 'google' }, { $set: { needsReconnect: true, lastError: RECONNECT_MESSAGE } });
}

async function authorizedClient() {
  const integration = await getIntegration('+encryptedRefreshToken');
  if (!integration.connected || !integration.encryptedRefreshToken) return { integration, client: null };
  let refreshToken;
  try {
    refreshToken = decryptToken(integration.encryptedRefreshToken);
  } catch (err) {
    await markReconnectNeeded();
    throw new CalendarSyncError(RECONNECT_MESSAGE, { reconnect: true });
  }
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return { integration, client };
}

async function calendarRequest(client, options) {
  try {
    const response = await client.request({ timeout: REQUEST_TIMEOUT_MS, ...options });
    return response.data;
  } catch (err) {
    const syncError = toSyncError(err);
    if (syncError.reconnect) await markReconnectNeeded();
    throw syncError;
  }
}

function eventUrl(calendarId, eventId = '') {
  const base = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

// Deletes only the Google event created for a school event; a missing event counts as removed.
async function deleteGoogleEvent(client, calendarId, eventId) {
  try {
    await calendarRequest(client, { url: eventUrl(calendarId, eventId), method: 'DELETE', params: { sendUpdates: 'none' } });
  } catch (err) {
    if (![404, 410].includes(err.status)) throw err;
  }
}

async function upsertGoogleEvent(client, calendarId, event) {
  const stored = event.googleCalendar || {};
  const eventId = stored.calendarId === calendarId && stored.eventId ? stored.eventId : googleEventIdFor(event._id);
  const body = googleEventBody(event);
  const params = { sendUpdates: 'none' };
  try {
    return await calendarRequest(client, { url: eventUrl(calendarId, eventId), method: 'PUT', data: body, params });
  } catch (err) {
    if (![404, 410].includes(err.status)) throw err;
  }
  try {
    return await calendarRequest(client, { url: eventUrl(calendarId), method: 'POST', data: { id: eventId, ...body }, params });
  } catch (err) {
    // 409: created by an earlier attempt that did not record its result; update it instead of duplicating.
    if (err.status !== 409) throw err;
    return calendarRequest(client, { url: eventUrl(calendarId, eventId), method: 'PUT', data: body, params });
  }
}

async function saveSyncState(eventId, values) {
  await Event.updateOne({ _id: eventId }, { $set: { googleCalendar: values } });
}

async function syncEventNow(eventId) {
  const event = await Event.findById(eventId).select('+googleCalendar');
  if (!event) return null;
  const stored = (event.googleCalendar && event.googleCalendar.toObject) ? event.googleCalendar.toObject() : (event.googleCalendar || {});
  const shouldExist = belongsInGoogle(event);
  if (!shouldExist && !stored.eventId) return stored;

  let integration;
  let client;
  try {
    ({ integration, client } = await authorizedClient());
  } catch (err) {
    const failed = { ...stored, status: 'failed', error: toSyncError(err).message, lastAttemptAt: new Date() };
    await saveSyncState(event._id, failed);
    return failed;
  }
  // Not connected: leave the record alone; "Sync now" after connecting brings everything up to date.
  if (!client) return stored;

  const calendarId = integration.calendarId || 'primary';
  await saveSyncState(event._id, { ...stored, status: 'pending', lastAttemptAt: new Date() });
  try {
    if (shouldExist) {
      const googleEvent = await upsertGoogleEvent(client, calendarId, event);
      const synced = {
        status: 'synced',
        calendarId,
        eventId: googleEvent.id,
        htmlLink: googleEvent.htmlLink || '',
        error: '',
        lastAttemptAt: new Date(),
        lastSyncedAt: new Date(),
      };
      await saveSyncState(event._id, synced);
      return synced;
    }
    await deleteGoogleEvent(client, stored.calendarId || calendarId, stored.eventId);
    const removed = { status: 'not-synced', calendarId: '', eventId: '', htmlLink: '', error: '', lastAttemptAt: new Date(), lastSyncedAt: new Date() };
    await saveSyncState(event._id, removed);
    return removed;
  } catch (err) {
    const syncError = toSyncError(err);
    console.error(`[calendar] Sync failed for event ${event._id}:`, syncError.message);
    const failed = { ...stored, status: 'failed', error: syncError.message, lastAttemptAt: new Date() };
    await saveSyncState(event._id, failed);
    return failed;
  }
}

// Runs syncs for the same event one after another so a later edit always wins.
function syncEvent(eventId) {
  const key = String(eventId);
  const previous = syncQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => syncEventNow(eventId));
  const settled = next.catch((err) => console.error(`[calendar] Sync error for event ${key}:`, err.message));
  syncQueues.set(key, settled);
  settled.finally(() => {
    if (syncQueues.get(key) === settled) syncQueues.delete(key);
  });
  return next;
}

// Fire-and-forget: Google problems never block the school calendar.
function queueEventSync(eventId) {
  syncEvent(eventId).catch(() => {});
}

async function removeDeletedEvent(event) {
  const stored = event.googleCalendar || {};
  if (!stored.eventId && !belongsInGoogle(event)) return;
  let integration;
  let client;
  try {
    ({ integration, client } = await authorizedClient());
  } catch (err) {
    integration = await getIntegration();
  }
  const calendarId = stored.calendarId || integration.calendarId || 'primary';
  const eventId = stored.eventId || googleEventIdFor(event._id);
  if (!integration.connected) return;
  try {
    if (!client) throw new CalendarSyncError(RECONNECT_MESSAGE, { reconnect: true });
    await deleteGoogleEvent(client, calendarId, eventId);
  } catch (err) {
    const syncError = toSyncError(err);
    console.error(`[calendar] Could not remove Google event for deleted event ${event._id}:`, syncError.message);
    await CalendarIntegration.updateOne({ key: 'google' }, {
      $push: { pendingDeletions: { calendarId, eventId, title: event.title || '', error: syncError.message } },
    });
  }
}

function queueEventRemoval(event) {
  removeDeletedEvent(event).catch((err) => console.error('[calendar] Removal error:', err.message));
}

async function syncAll() {
  const summary = { synced: 0, removed: 0, failed: 0, deletionsRetried: 0, deletionsFailed: 0 };
  const { integration, client } = await authorizedClient();
  if (!client) throw new CalendarSyncError('Google Calendar is not connected.');

  const remaining = [];
  for (const item of integration.pendingDeletions || []) {
    try {
      await deleteGoogleEvent(client, item.calendarId, item.eventId);
      summary.deletionsRetried += 1;
    } catch (err) {
      if (toSyncError(err).reconnect) throw toSyncError(err);
      summary.deletionsFailed += 1;
      remaining.push({ ...item.toObject(), error: toSyncError(err).message });
    }
  }
  await CalendarIntegration.updateOne({ key: 'google' }, { $set: { pendingDeletions: remaining } });

  const events = await Event.find({
    $or: [
      { publicationStatus: 'published', approvalStatus: 'approved' },
      { 'googleCalendar.eventId': { $nin: ['', null] } },
    ],
  }).select('_id');
  for (const { _id } of events) {
    const result = await syncEvent(_id);
    if (!result) continue;
    if (result.status === 'synced') summary.synced += 1;
    else if (result.status === 'failed') summary.failed += 1;
    else summary.removed += 1;
    if (result.status === 'failed' && /reconnect/i.test(result.error)) break;
  }
  await CalendarIntegration.updateOne({ key: 'google' }, {
    $set: { lastFullSyncAt: new Date(), lastError: summary.failed ? 'Some events could not be synced. Open an event to see its error.' : '' },
  });
  return summary;
}

async function createAuthorizationUrl(userId) {
  const state = crypto.randomBytes(32).toString('hex');
  await getIntegration();
  await CalendarIntegration.updateOne({ key: 'google' }, {
    $set: { pendingStateHash: hashState(state), pendingStateExpires: new Date(Date.now() + STATE_TTL_MS), pendingStateUser: userId },
  });
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    // consent guarantees Google returns a refresh token on every connect.
    prompt: 'consent',
    scope: CONNECT_SCOPES,
    state,
  });
}

// Returns the admin who started the flow when the state matches; clears it so it works once.
async function consumeState(state) {
  if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) return null;
  const integration = await CalendarIntegration.findOneAndUpdate(
    { key: 'google', pendingStateHash: hashState(state), pendingStateExpires: { $gt: new Date() } },
    { $set: { pendingStateHash: '', pendingStateExpires: null, pendingStateUser: null } },
    { projection: { pendingStateUser: 1 } }
  );
  return integration ? integration.pendingStateUser : null;
}

async function completeConnection(code, userId) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  const grantedScopes = String(tokens.scope || '').split(/\s+/);
  if (!grantedScopes.includes(CALENDAR_SCOPE)) {
    throw new CalendarSyncError('Calendar permission was not granted. Tick the Google Calendar permission when connecting.');
  }
  if (!tokens.refresh_token) throw new CalendarSyncError('Google did not return offline access. Try connecting again.');
  let accountEmail = '';
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    accountEmail = (ticket.getPayload() || {}).email || '';
  }
  await CalendarIntegration.updateOne({ key: 'google' }, {
    $set: {
      connected: true,
      needsReconnect: false,
      accountEmail,
      encryptedRefreshToken: encryptToken(tokens.refresh_token),
      connectedBy: userId,
      connectedAt: new Date(),
      lastError: '',
    },
  });
}

// Disconnecting never deletes events already in Google Calendar.
async function disconnect() {
  const integration = await getIntegration('+encryptedRefreshToken');
  if (integration.encryptedRefreshToken) {
    try {
      await oauthClient().revokeToken(decryptToken(integration.encryptedRefreshToken));
    } catch (err) {
      console.error('[calendar] Token revoke failed (continuing with disconnect):', err.message);
    }
  }
  await CalendarIntegration.updateOne({ key: 'google' }, {
    $set: { connected: false, needsReconnect: false, encryptedRefreshToken: '', accountEmail: '', lastError: '' },
  });
}

async function getStatus() {
  const integration = await getIntegration();
  const counts = await Event.aggregate([
    { $match: { publicationStatus: 'published', approvalStatus: 'approved' } },
    { $group: { _id: { $ifNull: ['$googleCalendar.status', 'not-synced'] }, total: { $sum: 1 } } },
  ]);
  const countFor = (status) => (counts.find((item) => item._id === status) || {}).total || 0;
  return {
    configured: !configurationError(),
    configurationError: configurationError(),
    connected: integration.connected,
    needsReconnect: integration.needsReconnect,
    accountEmail: integration.accountEmail,
    calendarId: integration.calendarId || 'primary',
    connectedAt: integration.connectedAt,
    lastFullSyncAt: integration.lastFullSyncAt,
    lastError: integration.lastError,
    timeZone: schoolTimeZone(),
    durationMinutes: eventDurationMinutes(),
    pendingDeletions: (integration.pendingDeletions || []).length,
    counts: {
      synced: countFor('synced'),
      failed: countFor('failed'),
      pending: countFor('pending'),
      notSynced: countFor('not-synced'),
    },
  };
}

module.exports = {
  CalendarSyncError,
  addToGoogleCalendarUrl,
  completeConnection,
  configurationError,
  consumeState,
  createAuthorizationUrl,
  disconnect,
  getIntegration,
  getStatus,
  googleEventBody,
  googleEventIdFor,
  queueEventRemoval,
  queueEventSync,
  syncAll,
  syncEvent,
  _test: { encryptToken, decryptToken, eventTimes, toSyncError, upsertGoogleEvent, deleteGoogleEvent },
};
