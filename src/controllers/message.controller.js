const MessageSchedule = require('../models/MessageSchedule');
const { parseSchedule } = require('../utils/schedule.helper');

async function scheduleMessage(req, res) {
  let input;
  try {
    input = parseSchedule(req.body);
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }

  try {
    const schedule = await MessageSchedule.create(input);
    return res.status(202).json({
      success: true,
      message: 'Message scheduled',
      data: {
        scheduleId: schedule._id,
        day: schedule.day,
        time: schedule.time,
        timezone: schedule.timezone,
        scheduledAt: schedule.scheduledAt,
        status: schedule.status
      }
    });
  } catch (error) {
    console.error('[MessageController] Failed to save schedule:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to schedule message' });
  }
}

module.exports = { scheduleMessage };
