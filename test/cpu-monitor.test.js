const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { createCpuSampler, startCpuMonitor } = require('../src/services/cpu.monitor.service');
const { startSupervisor } = require('../src/services/server.supervisor');
const quiet = { log() {}, warn() {}, error() {} };

test('CPU samples use elapsed process CPU time without rounding or dividing by core count', () => {
  const usage = [
    { user: 0, system: 0 },
    { user: 600000, system: 99990 },
    { user: 1200000, system: 199990 },
    { user: 3100000, system: 299990 }
  ];
  let time = 0n;
  const sample = createCpuSampler({
    readCpu: () => usage.shift(),
    readTime: () => { const result = time; time += 1000000000n; return result; }
  });
  assert.ok(Math.abs(sample() - 69.999) < 0.000001);
  assert.equal(sample(), 70);
  assert.equal(sample(), 200);
});

test('CPU monitor restarts once at 70%, exposes metrics, and stops sampling', async t => {
  const samples = [20, 69.999, 70, 90];
  let restarts = 0;
  const monitor = startCpuMonitor(async metrics => {
    restarts++;
    assert.equal(metrics.cpuPercentage, 70);
  }, { threshold: 70, intervalMs: 60000, sampleCpu: () => samples.shift(), logger: quiet });
  t.after(() => monitor.stop());
  assert.equal(monitor.getMetrics(), null);
  await monitor.check();
  await monitor.check();
  assert.equal(restarts, 0);
  await monitor.check();
  await monitor.check();
  assert.equal(restarts, 1);
  assert.equal(monitor.getMetrics().pid, process.pid);
  assert.equal(samples.length, 1);
});

test('invalid CPU settings are rejected', () => {
  assert.throws(() => startCpuMonitor(() => {}, { threshold: NaN }), /CPU_THRESHOLD/);
  assert.throws(() => startCpuMonitor(() => {}, { intervalMs: 0 }), /CPU_CHECK_INTERVAL/);
});

test('supervisor replaces the server process after a CPU-triggered exit and stops cleanly', { timeout: 10000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'insuredmine-supervisor-test-'));
  const fixturePath = path.join(directory, 'server.cjs');
  const markerPath = path.join(directory, 'started');
  const monitorPath = require.resolve('../src/services/cpu.monitor.service');
  await fs.writeFile(fixturePath, `
    const fs = require('node:fs');
    const { startCpuMonitor } = require(${JSON.stringify(monitorPath)});
    const marker = ${JSON.stringify(markerPath)};
    const first = !fs.existsSync(marker);
    fs.writeFileSync(marker, 'started');
    const monitor = startCpuMonitor(() => process.exit(75), {
      threshold: 70, intervalMs: 50, sampleCpu: () => first ? 70 : 0,
      logger: { log() {}, warn() {}, error() {} }
    });
    process.on('message', message => {
      if (message.type === 'shutdown') { monitor.stop(); process.exit(0); }
    });
    process.on('disconnect', () => process.exit(0));
    process.send({ type: 'ready', pid: process.pid });
  `);
  const pids = [];
  const exits = [];
  const supervisor = startSupervisor({
    entrypoint: fixturePath,
    restartDelayMs: 20,
    attachSignals: false,
    logger: quiet,
    forkProcess: (file, args, options) => {
      const child = fork(file, args, { ...options, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      child.on('message', message => { if (message.type === 'ready') pids.push(message.pid); });
      child.on('exit', code => exits.push(code));
      return child;
    }
  });
  t.after(async () => {
    await supervisor.stop();
    for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    await fs.rmdir(directory);
  });
  const deadline = Date.now() + 6000;
  while (pids.length < 2 && Date.now() < deadline) await delay(20);
  assert.equal(pids.length, 2);
  assert.notEqual(pids[0], pids[1]);
  assert.equal(exits[0], 75);
  await supervisor.stop();
  await delay(100);
  assert.equal(pids.length, 2, 'Intentional shutdown must not restart the child');
  assert.equal(exits[1], 0);
});
