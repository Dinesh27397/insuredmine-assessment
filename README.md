# InsuredMine assessment API

## Recruiter quick start

. Use Node.js 22 or newer, npm, a running
MongoDB instance, and the Postman desktop app.

1. Clone/download the repository and open a terminal in its root folder.

2. Install dependencies with `npm ci`.
3. Create `.env` from [.env.example](.env.example). On a fresh Windows checkout,
   run `Copy-Item .env.example .env`; on macOS/Linux use `cp .env.example .env`.
4. Set `MONGODB_URI` to your own assessment database. The template uses a local
   MongoDB at `mongodb://127.0.0.1:27017/insuredmine_assessment`. Start MongoDB
   locally or replace the URI with your MongoDB Atlas connection string.
5. Run `npm start` and keep the terminal open. Wait for `Server running on port
   5000`. The upload directory is created automatically. `npm run dev` is also
   supported.
6. Import [the Postman collection](postman/InsuredMine.postman_collection.json)
   into Postman. Its `baseUrl` defaults to `http://localhost:5000`.
7. Run requests in their numbered order. For both upload requests, open
   **Body > form-data** and select [samples/policies.csv](samples/policies.csv)
   as the file for the `file` key. Let Postman set the multipart header.

The sample file contains three fictional policies belonging to two fictional
users. No authentication is required by the current assessment API. The
collection includes response assertions visible under Postman's test results.
See the [Postman import guide](https://learning.postman.com/docs/getting-started/importing-and-exporting/importing-data/)
if needed.

| Check | Request | Expected result |
| --- | --- | --- |
| Health | `GET /api/health` | `200`, `status: "Up"` |
| Import sample | `POST /api/import`, multipart `file` | `200`; `data.data.imported` reports 3 rows, 2 users, 3 policies |
| Repeat import | Send the same sample again | All `data.data.databaseWrites` values are 0 |
| Search | `GET /api/policies/search?username=Alex%20Reviewer` | 2 policies: `REVIEW-001` and `REVIEW-002` |
| Partial search | `GET /api/policies/search?username=alex` | The same 2 policies, ignoring case |
| Group by user | `GET /api/policies/users` | Alex Reviewer has 2 policies; Casey Tester has 1 |
| CPU metrics | `GET /api/metrics/cpu` | Process ID, CPU usage, threshold 70; wait one second after startup |
| Schedule | `POST /api/messages` | `202`, a `scheduleId`, and `status: "pending"` |
| Invalid input | Requests in the last collection folder | `400` for missing username/file or invalid/past schedules |

The schedule request automatically calculates a date and time **60 seconds in
the future in India time**. Its response saves `scheduleId` in the collection
variables. `202` confirms that the job was saved; verify delivery in MongoDB as
described below.

## Verify message insertion and restart recovery

Connect MongoDB Compass or mongosh to the same database configured in `.env`.
Copy `data.scheduleId` from the schedule response and replace the placeholder:

```javascript
db.message_schedules.findOne({ _id: ObjectId("PASTE_SCHEDULE_ID") })
db.messages.findOne({ _id: ObjectId("PASTE_SCHEDULE_ID") })
```

Before the due time, the schedule is pending and the second query returns `null`.
After the due time and the next scheduler poll, the schedule is completed and
the message exists with `insertedAt` at or after `scheduledAt`.

For restart recovery, schedule another message, stop the server with Ctrl+C
before it is due, then run `npm start` after the due time. The pending message
should be inserted automatically. Restart once more and verify there is still
only one message for that schedule:

```javascript
db.messages.countDocuments({ _id: ObjectId("PASTE_SCHEDULE_ID") })
// Expected: 1
```

## Automated checks

Run these in a second terminal from the project folder:

```text
npm test
npm run test:cpu
```

`npm test` runs regression tests without needing a database. They cover imports,
policy searches, schedule validation/recovery, and CPU threshold behavior.
`npm run test:cpu` generates a short CPU spike in an isolated Node process using
the application's monitor and supervisor. It prints `realCpuRestart: "PASS"`,
the measured CPU percentage (at least 70), and different old/new process IDs.
It cleans up its processes afterward and does not restart the running API.

## CPU monitoring and restart

The server logs its process CPU usage every second and restarts when a sample is
at least 70%. `src/server.js` supervises the HTTP server process, so this works
with `npm start` as well as nodemon. Shutdown stops new HTTP requests, finishes
active work within a ten-second grace period, and closes MongoDB before restart.

`GET /api/metrics/cpu` returns the latest sample, PID, threshold, memory usage,
and event loop delay. Its `data` is `null` until the first sample.

CPU is measured relative to one logical core: 100% means one core fully busy.
Worker threads count toward the process total, which can exceed 100%.
Configuration: `CPU_THRESHOLD=70`, `CPU_CHECK_INTERVAL=1000` (milliseconds).
Sampling resumes after the new server starts. Stopping the supervisor stops the
server without restarting it.

## Schedule a message

`POST /api/messages` with `Content-Type: application/json`:

```json
{
  "message": "Your policy renewal is due",
  "day": "2026-09-20",
  "time": "14:30:00"
}
```

Choose a future date. `day` is `YYYY-MM-DD`; `time` is 24-hour `HH:mm` or
`HH:mm:ss`. All input times use **Asia/Kolkata (IST, UTC+05:30)**. The example
corresponds to `2026-09-20T09:00:00.000Z` in MongoDB.

The endpoint returns `202 Accepted` with `data.scheduleId`, `scheduledAt`, and
`status: "pending"`. Invalid messages/dates/times and past schedules return `400`.

The pending job is saved immediately in `message_schedules`. At the due time,
the scheduler inserts the final document into `messages` with `message`,
`scheduledAt`, and `insertedAt`, then marks the schedule completed. Both records
share the same `_id` so a retry cannot create a second message for that schedule.

Schedules survive server and CPU-triggered restarts. Overdue jobs run when the
server returns; database failures leave jobs pending for retry. Polling defaults
to one second (`MESSAGE_POLL_INTERVAL_MS=1000`), so insertion occurs on the next
poll after the due time, plus database latency. These are one-time schedules.
