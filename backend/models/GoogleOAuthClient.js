const mongoose = require('mongoose');

const googleOAuthClientSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 80 },
    clientId: { type: String, required: true, trim: true, maxlength: 256 },
    normalizedClientId: { type: String, required: true, unique: true },
    encryptedClientSecret: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GoogleOAuthClient', googleOAuthClientSchema);
