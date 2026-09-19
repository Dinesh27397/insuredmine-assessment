const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { startSupervisor } = require('../src/services/server.supervisor');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'insuredmine-cpu-check-'));
  const fixture = path.join(directory, 'server.cjs');
  const marker = path.join(directory, 'started');
  await fs.writeFile(fixture, `
    const fs = require('node:fs');
    const { startCpuMonitor } = require(${JSON.stringify(require.resolve('../src/services/cpu.monitor.service'))});
    const first = !fs.existsSync(${JSON.stringify(marker)});
    fs.writeFileSync(${JSON.stringify(marker)}, 'started');
    const monitor = startCpuMonitor(metrics => {
      process.send({ type: 'threshold', cpu: metrics.cpuPercentage }, () => process.exit(75));
    }, { threshold: 70, intervalMs: 200, logger: { log() {}, warn() {}, error() {} } });
    process.on('message', message => {
      if (message.type === 'shutdown') { monitor.stop(); process.exit(0); }
    });
    process.on('disconnect', () => process.exit(0));
    process.send({ type: 'ready', pid: process.pid });
    if (first) setTimeout(() => {
      const end = performance.now() + 1500;
      while (performance.now() < end) Math.sqrt(Math.random());
    }, 25);
  `);
  const pids = [];
  let measuredCpu;
  const supervisor = startSupervisor({
    entrypoint: fixture, restartDelayMs: 100, attachSignals: false,
    logger: { log() {}, warn() {}, error: console.error },
    forkProcess: (file, args, options) => {
      const child = fork(file, args, { ...options, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      child.on('message', message => {
        if (message.type === 'ready') pids.push(message.pid);
        if (message.type === 'threshold') measuredCpu = message.cpu;
      });
      return child;
    }
  });
  try {
    const deadline = Date.now() + 10000;
    while (pids.length < 2 && Date.now() < deadline) await delay(50);
    assert.equal(pids.length, 2, 'CPU spike should cause a replacement process');
    assert.ok(measuredCpu >= 70);
    assert.notEqual(pids[0], pids[1]);
    console.log(JSON.stringify({ realCpuRestart: 'PASS', cpuPercentage: measuredCpu, previousPid: pids[0], replacementPid: pids[1] }));
  } finally {
    await supervisor.stop();
    for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    await fs.rmdir(directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
