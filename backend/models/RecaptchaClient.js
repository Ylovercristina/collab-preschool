const mongoose = require('mongoose');

const recaptchaClientSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 80 },
    siteKey: { type: String, required: true, trim: true, maxlength: 256 },
    allowedHostnames: { type: [String], required: true },
    normalizedSiteKey: { type: String, required: true, unique: true },
    encryptedSecret: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RecaptchaClient', recaptchaClientSchema);
