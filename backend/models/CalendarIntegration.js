const mongoose = require('mongoose');

// Single school-wide Google Calendar connection, managed by admins.
const calendarIntegrationSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'google' },
    connected: { type: Boolean, default: false },
    needsReconnect: { type: Boolean, default: false },
    accountEmail: { type: String, trim: true, default: '' },
    calendarId: { type: String, trim: true, default: 'primary' },
    // AES-256-GCM encrypted; never returned to the browser.
    encryptedRefreshToken: { type: String, default: '', select: false },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    connectedAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
    lastFullSyncAt: { type: Date, default: null },
    // OAuth state is stored hashed so the callback can verify the request came from this app.
    pendingStateHash: { type: String, default: '', select: false },
    pendingStateExpires: { type: Date, default: null, select: false },
    pendingStateUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, select: false },
    // Google events whose school event was deleted while Google was unreachable; retried by "Sync now".
    pendingDeletions: [{
      _id: false,
      calendarId: { type: String, default: '' },
      eventId: { type: String, default: '' },
      title: { type: String, default: '' },
      error: { type: String, default: '' },
      queuedAt: { type: Date, default: Date.now },
    }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('CalendarIntegration', calendarIntegrationSchema);
