const mongoose = require('mongoose');

const personalGoogleCalendarEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    googleEventId: { type: String, required: true },
    calendarId: { type: String, default: 'primary' },
    status: { type: String, enum: ['pending', 'synced', 'failed', 'cancelled', 'removed'], default: 'pending' },
    htmlLink: { type: String, default: '' },
    error: { type: String, default: '' },
    lastSyncedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

personalGoogleCalendarEventSchema.index({ userId: 1, eventId: 1 }, { unique: true });

module.exports = mongoose.model('PersonalGoogleCalendarEvent', personalGoogleCalendarEventSchema);
