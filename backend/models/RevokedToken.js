const mongoose = require('mongoose');

// Login tokens that were ended by logging out. Only a SHA-256 hash of the token is stored.
// MongoDB deletes each entry automatically once the token would have expired anyway.
const revokedTokenSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  expiresAt: { type: Date, required: true },
});

revokedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RevokedToken', revokedTokenSchema);
