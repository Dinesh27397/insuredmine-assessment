const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const MessageSchedule = require('../src/models/MessageSchedule');
const messageRoutes = require('../src/routes/message.routes');
const { parseSchedule } = require('../src/utils/schedule.helper');
const { startMessageScheduler } = require('../src/services/message.scheduler.service');
const quiet = { log() {}, error() {} };

test('schedule dates are validated and converted from India time independently of server timezone', () => {
  const now = new Date('2026-09-19T00:00:00Z');
  const parsed = parseSchedule({ message: ' Reminder ', day: '2026-09-20', time: '14:30' }, now);
  assert.equal(parsed.scheduledAt.toISOString(), '2026-09-20T09:00:00.000Z');
  assert.equal(parsed.message, 'Reminder');
  assert.equal(parsed.timezone, 'Asia/Kolkata');
  const midnight = parseSchedule({ message: 'x', day: '2026-09-20', time: '00:00:05' }, now);
  assert.equal(midnight.scheduledAt.toISOString(), '2026-09-19T18:30:05.000Z');
  assert.equal(parseSchedule({ message: 'x', day: '2028-02-29', time: '09:00' }, now).day, '2028-02-29');
  for (const body of [
    {}, { message: ' ', day: '2026-09-20', time: '09:00' },
    { message: 'x'.repeat(10001), day: '2026-09-20', time: '09:00' },
    { message: 'x', day: '2027-02-29', time: '09:00' },
    { message: 'x', day: '2026-04-31', time: '09:00' },
    { message: 'x', day: 'Sunday', time: '09:00' },
    { message: 'x', day: '2026-09-20', time: '24:00' },
    { message: 'x', day: '2026-09-20', time: '12:60' },
    { message: 'x', day: '2026-09-20', time: '12:00:60' },
    { message: 'x', day: '2026-09-18', time: '12:00' },
    { message: 'x', day: '2026-09-19', time: '05:30' }
  ]) assert.throws(() => parseSchedule(body, now));
});

function fakeDatabase(jobs) {
  const inserted = new Map();
  const schedules = {
    find(filter) {
      assert.equal(filter.status, 'pending');
      return {
        sort() { return this; },
        limit(count) { assert.equal(count, 100); return this; },
        async lean() { return jobs.filter(job => job.status === 'pending' && job.scheduledAt <= filter.scheduledAt.$lte); }
      };
    },
    async updateOne(filter, update) {
      if (schedules.failCompletionOnce) { schedules.failCompletionOnce = false; throw new Error('Interrupted before completion'); }
      Object.assign(jobs.find(job => job._id === filter._id), update.$set);
    }
  };
  const messages = {
    async updateOne(filter, update, options) {
      assert.equal(options.upsert, true);
      if (messages.failOnce === filter._id) { messages.failOnce = null; throw new Error('Temporary write failure'); }
      if (!inserted.has(filter._id)) inserted.set(filter._id, { _id: filter._id, ...update.$setOnInsert });
    }
  };
  return { schedules, messages, inserted };
}

test('scheduler inserts due messages, leaves future jobs untouched and retries independent failures', async t => {
  let now = new Date('2026-09-20T09:00:00Z');
  const jobs = [
    { _id: 'one', message: 'one', scheduledAt: new Date(now), status: 'pending' },
    { _id: 'two', message: 'two', scheduledAt: new Date(now), status: 'pending' },
    { _id: 'future', message: 'future', scheduledAt: new Date('2026-09-20T09:01:00Z'), status: 'pending' }
  ];
  const database = fakeDatabase(jobs);
  database.messages.failOnce = 'one';
  const scheduler = startMessageScheduler({ ...database, intervalMs: 60000, now: () => now, logger: quiet });
  t.after(() => scheduler.stop());
  await scheduler.tick();
  assert.deepEqual([...database.inserted.keys()], ['two']);
  assert.equal(jobs[0].status, 'pending');
  await scheduler.tick();
  assert.equal(database.inserted.size, 2);
  assert.equal(jobs[2].status, 'pending');
  now = new Date('2026-09-20T09:01:00Z');
  await scheduler.tick();
  assert.equal(database.inserted.size, 3);
  assert.ok(jobs.every(job => job.status === 'completed'));
});

test('restart recovers overdue jobs without duplicating an insert completed before an interruption', async t => {
  let now = new Date('2026-09-20T09:00:00Z');
  const jobs = [{ _id: 'recover', message: 'Recovery', scheduledAt: new Date(now), status: 'pending' }];
  const database = fakeDatabase(jobs);
  database.schedules.failCompletionOnce = true;
  const first = startMessageScheduler({ ...database, intervalMs: 60000, now: () => now, logger: quiet });
  await first.tick();
  assert.equal(database.inserted.size, 1);
  assert.equal(jobs[0].status, 'pending');
  const insertedAt = database.inserted.get('recover').insertedAt;
  await first.stop();
  now = new Date('2026-09-20T10:00:00Z');
  const restarted = startMessageScheduler({ ...database, intervalMs: 60000, now: () => now, logger: quiet });
  t.after(() => restarted.stop());
  await restarted.tick();
  assert.equal(database.inserted.size, 1);
  assert.equal(database.inserted.get('recover').insertedAt, insertedAt);
  assert.equal(jobs[0].status, 'completed');
});

test('POST /api/messages accepts valid schedules and rejects invalid input before database writes', async t => {
  const saved = [];
  t.mock.method(MessageSchedule, 'create', async input => {
    saved.push(input);
    return { ...input, _id: 'schedule-id', status: 'pending' };
  });
  const app = express();
  app.use(express.json());
  app.use('/api/messages', messageRoutes);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/messages`;
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Reminder', day: '2099-09-20', time: '14:30' })
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.data.status, 'pending');
  assert.equal(body.data.scheduledAt, '2099-09-20T09:00:00.000Z');
  assert.equal(body.data.timezone, 'Asia/Kolkata');
  assert.equal(saved.length, 1);
  const invalid = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Missing day' })
  });
  assert.equal(invalid.status, 400);
  assert.equal(saved.length, 1);
});
