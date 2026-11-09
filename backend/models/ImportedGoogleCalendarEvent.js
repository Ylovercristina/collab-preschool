const mongoose = require('mongoose');

const importedGoogleCalendarEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    googleEventId: { type: String, required: true },
    status: { type: String, enum: ['active', 'removed'], default: 'active', index: true },
    title: { type: String, trim: true, required: true },
    description: { type: String, trim: true, default: '' },
    date: { type: Date, required: true, index: true },
    time: { type: String, trim: true, default: '' },
    venue: { type: String, trim: true, default: '' },
    allDay: { type: Boolean, default: false },
    htmlLink: { type: String, trim: true, default: '' },
    googleUpdatedAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

importedGoogleCalendarEventSchema.index({ userId: 1, googleEventId: 1 }, { unique: true });
importedGoogleCalendarEventSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('ImportedGoogleCalendarEvent', importedGoogleCalendarEventSchema);
