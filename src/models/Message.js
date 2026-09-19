const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  message: { type: String, required: true, maxlength: 10000 },
  scheduledAt: { type: Date, required: true },
  insertedAt: { type: Date, required: true }
}, { collection: 'messages' });

module.exports = mongoose.model('Message', schema);
