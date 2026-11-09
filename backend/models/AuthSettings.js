const mongoose = require('mongoose');

const authSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'global' },
    googleAuthEnabled: { type: Boolean, default: true },
    captchaEnabled: { type: Boolean, default: true },
    customGoogleClientEnabled: { type: Boolean, default: false },
    customGoogleClientId: { type: String, default: '', trim: true, maxlength: 256 },
    activeGoogleOAuthClientId: { type: String, default: '', trim: true, maxlength: 64 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AuthSettings', authSettingsSchema);
