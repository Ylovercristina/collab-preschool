const mongoose = require('mongoose');

// "Someone is editing this" lock. One per record; held while an edit form is open and renewed by
// a heartbeat. Expired locks are ignored immediately and removed by MongoDB's TTL monitor.
const editLockSchema = new mongoose.Schema(
  {
    resource: { type: String, required: true, trim: true },
    recordId: { type: mongoose.Schema.Types.ObjectId, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true, trim: true },
    userRole: { type: String, trim: true, default: '' },
    acquiredAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false }
);

editLockSchema.index({ resource: 1, recordId: 1 }, { unique: true });
editLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('EditLock', editLockSchema);
