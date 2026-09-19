const MessageSchedule = require('../models/MessageSchedule');
const Message = require('../models/Message');

function startMessageScheduler({
  schedules = MessageSchedule,
  messages = Message,
  intervalMs = Number(process.env.MESSAGE_POLL_INTERVAL_MS || 1000),
  now = () => new Date(),
  logger = console
} = {}) {
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 2147483647) {
    throw new Error('MESSAGE_POLL_INTERVAL_MS must be a positive timer interval');
  }
  let stopped = false;
  let timer;
  let inFlight;

  async function deliverDueMessages() {
    const due = await schedules.find({ status: 'pending', scheduledAt: { $lte: now() } })
      .sort({ scheduledAt: 1 }).limit(100).lean();
    for (const job of due) {
      if (stopped) break;
      try {
        // Reusing the schedule ID makes retries after a crash idempotent.
        await messages.updateOne({ _id: job._id }, {
          $setOnInsert: { message: job.message, scheduledAt: job.scheduledAt, insertedAt: now() }
        }, { upsert: true, runValidators: true });
        await schedules.updateOne({ _id: job._id, status: 'pending' }, {
          $set: { status: 'completed', completedAt: now() }
        });
        logger.log(`[MessageScheduler] Inserted scheduled message ${job._id}`);
      } catch (error) {
        // Leave the schedule pending so the next poll or server restart retries it.
        logger.error(`[MessageScheduler] Delivery failed for ${job._id}:`, error.message);
      }
    }
  }

  function tick() {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    clearTimeout(timer);
    inFlight = deliverDueMessages()
      .catch(error => logger.error('[MessageScheduler] Poll failed:', error.message))
      .finally(() => {
        inFlight = undefined;
        if (!stopped) {
          timer = setTimeout(tick, intervalMs);
          timer.unref();
        }
      });
    return inFlight;
  }

  // Recover overdue schedules immediately at startup.
  tick();
  return {
    tick,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    }
  };
}

module.exports = { startMessageScheduler };
