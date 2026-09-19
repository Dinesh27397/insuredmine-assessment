function parseSchedule(body, now = new Date()) {
  const { message, day, time } = body || {};
  if (typeof message !== 'string' || !message.trim() || message.trim().length > 10000) {
    throw new Error('message must contain between 1 and 10000 characters');
  }
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error('day must be a valid date in YYYY-MM-DD format');
  }
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new Error('day must be a valid calendar date');
  }
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) {
    throw new Error('time must use 24-hour HH:mm or HH:mm:ss format');
  }

  const scheduledAt = new Date(`${day}T${time.length === 5 ? `${time}:00` : time}+05:30`);
  if (scheduledAt <= now) throw new Error('Scheduled date and time must be in the future (Asia/Kolkata)');
  return { message: message.trim(), day, time, timezone: 'Asia/Kolkata', scheduledAt };
}

module.exports = { parseSchedule };
