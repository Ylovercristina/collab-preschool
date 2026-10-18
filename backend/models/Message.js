const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function () { return !this.conversation; },
    },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    content: { type: String, required: true, trim: true },
    read: { type: Boolean, default: false },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
