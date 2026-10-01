const mongoose = require('mongoose');

const receiptCounterSchema = new mongoose.Schema({
  _id: { type: String },
  sequence: { type: Number, default: 0 },
});

module.exports = mongoose.model('ReceiptCounter', receiptCounterSchema);