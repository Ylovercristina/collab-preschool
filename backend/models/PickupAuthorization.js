const mongoose = require('mongoose');

const pickupAuthorizationSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    authorizedName: { type: String, required: true, trim: true },
    relationship: { type: String, required: true, trim: true },
    contact: { type: String, required: true, trim: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verified: [
      {
        date: { type: Date, default: Date.now },
        verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('PickupAuthorization', pickupAuthorizationSchema);
