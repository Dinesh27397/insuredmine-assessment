const path = require('node:path');
const { fork } = require('node:child_process');

function startSupervisor({
  entrypoint = path.join(__dirname, '../server.runtime.js'),
  restartDelayMs = 1000,
  forkProcess = fork,
  logger = console,
  attachSignals = true
} = {}) {
  let child;
  let restartTimer;
  let forceTimer;
  let stopping = false;
  let stopPromise;
  let resolveStop;
  const signals = ['SIGINT', 'SIGTERM', 'SIGUSR2'];

  function finishStop() {
    clearTimeout(forceTimer);
    if (attachSignals) {
      for (const signal of signals) process.removeListener(signal, stop);
      process.removeListener('message', onMessage);
      process.removeListener('disconnect', stop);
    }
    resolveStop?.();
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    clearTimeout(restartTimer);
    stopPromise = new Promise(resolve => { resolveStop = resolve; });
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      finishStop();
    } else {
      forceTimer = setTimeout(() => child?.kill(), 11000);
      if (child.connected) {
        child.send({ type: 'shutdown' }, error => { if (error) child?.kill(); });
      } else {
        child.kill();
      }
    }
    return stopPromise;
  }

  function onMessage(message) {
    if (message?.type === 'shutdown') stop();
  }

  function launch() {
    if (stopping) return;
    child = forkProcess(entrypoint, [], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      windowsHide: true
    });
    logger.log(`[Supervisor] Started server process ${child.pid}`);
    child.on('message', message => {
      if (attachSignals && process.connected) process.send({ ...message, serverPid: child.pid }, () => {});
    });
    child.once('error', error => logger.error('[Supervisor] Child process error:', error.message));
    child.once('exit', (code, signal) => {
      child = undefined;
      if (stopping) return finishStop();
      logger.warn(`[Supervisor] Server exited (${signal || code}); restarting in ${restartDelayMs}ms`);
      restartTimer = setTimeout(launch, restartDelayMs);
    });
  }

  if (attachSignals) {
    for (const signal of signals) process.on(signal, stop);
    process.on('message', onMessage);
    if (process.connected) process.on('disconnect', stop);
  }
  launch();
  return { stop, getChild: () => child };
}

module.exports = { startSupervisor };
