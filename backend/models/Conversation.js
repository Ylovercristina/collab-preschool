const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1, updatedAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
