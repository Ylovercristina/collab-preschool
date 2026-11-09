const mongoose = require('mongoose');

const personalGoogleCalendarConnectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    connected: { type: Boolean, default: false },
    needsReconnect: { type: Boolean, default: false },
    shareCalendarWithSchool: { type: Boolean, default: false },
    sharedCalendarConsentAt: { type: Date, default: null },
    accountEmail: { type: String, trim: true, default: '' },
    googleAccountId: { type: String, trim: true, default: '' },
    oauthClientSelectionId: { type: String, trim: true, default: 'default' },
    encryptedRefreshToken: { type: String, default: '', select: false },
    calendarSyncToken: { type: String, default: '', select: false },
    lastCalendarSyncAt: { type: Date, default: null },
    lastCalendarSyncError: { type: String, default: '' },
    connectedAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
    pendingStateHash: { type: String, default: '', select: false },
    pendingStateExpires: { type: Date, default: null, select: false },
    pendingOAuthClientSelectionId: { type: String, trim: true, default: 'default', select: false },
    pendingShareConsent: { type: Boolean, default: false, select: false },
  },
  { timestamps: true }
);

personalGoogleCalendarConnectionSchema.index({ connected: 1, lastCalendarSyncAt: 1 });

module.exports = mongoose.model('PersonalGoogleCalendarConnection', personalGoogleCalendarConnectionSchema);
