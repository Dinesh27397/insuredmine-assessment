const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  message: { type: String, required: true, maxlength: 10000 },
  day: { type: String, required: true },
  time: { type: String, required: true },
  timezone: { type: String, default: 'Asia/Kolkata' },
  scheduledAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
  completedAt: Date
}, { timestamps: true, collection: 'message_schedules' });

schema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model('MessageSchedule', schema);
