const mongoose = require('mongoose');

const personalGoogleCalendarConnectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    connected: { type: Boolean, default: false },
    needsReconnect: { type: Boolean, default: false },
    accountEmail: { type: String, trim: true, default: '' },
    oauthClientSelectionId: { type: String, trim: true, default: 'default' },
    encryptedRefreshToken: { type: String, default: '', select: false },
    connectedAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
    pendingStateHash: { type: String, default: '', select: false },
    pendingStateExpires: { type: Date, default: null, select: false },
    pendingOAuthClientSelectionId: { type: String, trim: true, default: 'default', select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PersonalGoogleCalendarConnection', personalGoogleCalendarConnectionSchema);
