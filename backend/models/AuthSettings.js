const mongoose = require('mongoose');

const authSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'global' },
    googleAuthEnabled: { type: Boolean, default: true },
    captchaEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AuthSettings', authSettingsSchema);
