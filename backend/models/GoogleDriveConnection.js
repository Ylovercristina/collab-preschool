const mongoose = require('mongoose');

const googleDriveConnectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    connected: { type: Boolean, default: false },
    needsReconnect: { type: Boolean, default: false },
    pickerScopeVersion: { type: Number, default: 0 },
    accountEmail: { type: String, trim: true, lowercase: true, default: '' },
    googleAccountId: { type: String, default: '' },
    oauthClientSelectionId: { type: String, default: '' },
    encryptedRefreshToken: { type: String, select: false, default: '' },
    connectedAt: { type: Date },
    lastError: { type: String, default: '' },
    pendingStateHash: { type: String, select: false, default: '' },
    pendingStateExpires: { type: Date, select: false, default: null },
    pendingOAuthClientSelectionId: { type: String, select: false, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GoogleDriveConnection', googleDriveConnectionSchema);
