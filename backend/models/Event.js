const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    date: { type: Date, required: true },
    time: { type: String, trim: true, default: '' },
    venue: { type: String, trim: true, default: '' },
    // Pinned map location for the venue; null when the venue was typed manually.
    location: {
      type: new mongoose.Schema({
        address: { type: String, trim: true, default: '' },
        lat: { type: Number, min: -90, max: 90, required: true },
        lng: { type: Number, min: -180, max: 180, required: true },
        placeId: { type: String, trim: true, default: '' },
      }, { _id: false }),
      default: null,
    },
    targetType: { type: String, enum: ['all', 'classes'], default: 'all' },
    targetClasses: [{ type: String, trim: true }],
    publicationStatus: { type: String, enum: ['draft', 'pending', 'published', 'rejected'], default: 'published', index: true },
    reviewStatus: { type: String, enum: ['not-required', 'pending', 'publishing', 'approved', 'rejected'], default: 'not-required', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNotes: { type: String, trim: true, default: '' },
    approvalStatus: { type: String, enum: ['pending', 'approved'], default: 'pending', index: true },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Link to the copy of this event in the school's Google Calendar; only returned to admins.
    googleCalendar: {
      type: new mongoose.Schema({
        status: { type: String, enum: ['not-synced', 'pending', 'synced', 'failed'], default: 'not-synced' },
        calendarId: { type: String, default: '' },
        eventId: { type: String, default: '' },
        htmlLink: { type: String, default: '' },
        error: { type: String, default: '' },
        lastAttemptAt: { type: Date, default: null },
        lastSyncedAt: { type: Date, default: null },
      }, { _id: false }),
      default: () => ({}),
      select: false,
    },
    emailRecipientCount: { type: Number, default: 0 },
    audience: { type: String, enum: ['all', 'teachers', 'parents'], default: 'parents' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Event', eventSchema);
