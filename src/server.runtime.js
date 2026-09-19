require('dotenv').config({ quiet: true });
const { once } = require('node:events');
const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/db');
const Message = require('./models/Message');
const MessageSchedule = require('./models/MessageSchedule');
const { startCpuMonitor } = require('./services/cpu.monitor.service');
const { startMessageScheduler } = require('./services/message.scheduler.service');

let server;
let cpuMonitor;
let scheduler;
let shuttingDown = false;

async function gracefulShutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] Initiated: ${reason}`);
  cpuMonitor?.stop();
  const forceTimer = setTimeout(() => {
    console.error('[Shutdown] Forced shutdown');
    process.exit(exitCode || 1);
  }, 10000);
  forceTimer.unref();
  try {
    await Promise.all([
      scheduler?.stop(),
      server && new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    ]);
    await mongoose.disconnect();
    process.exit(exitCode);
  } catch (error) {
    console.error('[Shutdown] Error:', error.message);
    process.exit(1);
  }
}

async function startServer() {
  await connectDB();
  await Promise.all([Message.init(), MessageSchedule.init()]);
  if (shuttingDown) return;
  server = app.listen(Number(process.env.PORT || 5000));
  await once(server, 'listening');
  cpuMonitor = startCpuMonitor(metrics => {
    console.warn(`[Server] Restart requested at ${metrics.cpuPercentage.toFixed(2)}% CPU`);
    return gracefulShutdown('CPU_THRESHOLD_EXCEEDED', 75);
  });
  app.locals.cpuMonitor = cpuMonitor;
  scheduler = startMessageScheduler();
  const port = server.address().port;
  console.log(`Server running on port ${port} (PID ${process.pid})`);
  if (process.connected) process.send({ type: 'ready', port, pid: process.pid }, () => {});
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('message', message => {
  if (message?.type === 'shutdown') gracefulShutdown('SUPERVISOR_SHUTDOWN');
});
process.on('disconnect', () => gracefulShutdown('SUPERVISOR_DISCONNECTED'));

startServer().catch(error => {
  console.error('[Server] Startup failed:', error.message);
  gracefulShutdown('STARTUP_FAILURE', 1);
});
