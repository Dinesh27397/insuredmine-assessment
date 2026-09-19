const { monitorEventLoopDelay } = require('node:perf_hooks');

const CPU_THRESHOLD = Number(process.env.CPU_THRESHOLD || 70);
const CPU_CHECK_INTERVAL = Number(process.env.CPU_CHECK_INTERVAL || 1000);

function createCpuSampler({
  readCpu = () => process.cpuUsage(),
  readTime = () => process.hrtime.bigint()
} = {}) {
  let previousCpu = readCpu();
  let previousTime = readTime();
  return () => {
    const currentCpu = readCpu();
    const currentTime = readTime();
    const elapsedMicroseconds = Number(currentTime - previousTime) / 1000;
    const consumedMicroseconds = currentCpu.user - previousCpu.user + currentCpu.system - previousCpu.system;
    previousCpu = currentCpu;
    previousTime = currentTime;
    return elapsedMicroseconds > 0 ? consumedMicroseconds / elapsedMicroseconds * 100 : 0;
  };
}

function startCpuMonitor(onThresholdExceeded, {
  threshold = CPU_THRESHOLD,
  intervalMs = CPU_CHECK_INTERVAL,
  sampleCpu = createCpuSampler(),
  logger = console
} = {}) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) {
    throw new Error('CPU_THRESHOLD must be greater than 0 and at most 100');
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 2147483647) {
    throw new Error('CPU_CHECK_INTERVAL must be a positive timer interval');
  }

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let stopped = false;
  let latest = null;
  let timer;
  function stop() {
    stopped = true;
    clearInterval(timer);
    histogram.disable();
  }

  async function check() {
    if (stopped) return latest;
    try {
      const cpuPercentage = sampleCpu();
      const memory = process.memoryUsage();
      latest = {
        pid: process.pid,
        sampledAt: new Date().toISOString(),
        cpuPercentage,
        thresholdPercentage: threshold,
        checkIntervalMs: intervalMs,
        memory: {
          rssMB: Number((memory.rss / 1024 / 1024).toFixed(2)),
          heapUsedMB: Number((memory.heapUsed / 1024 / 1024).toFixed(2))
        },
        eventLoopDelay: {
          meanMs: Number.isFinite(histogram.mean) ? Number((histogram.mean / 1e6).toFixed(2)) : 0,
          p99Ms: Number((histogram.percentile(99) / 1e6).toFixed(2))
        }
      };
      logger.log(`[CPU Monitor] PID=${process.pid} CPU=${cpuPercentage.toFixed(2)}% Heap=${latest.memory.heapUsedMB}MB`);
      histogram.reset();
      // Compare the unrounded value so 69.999% does not trigger a 70% restart.
      if (cpuPercentage >= threshold) {
        stop();
        logger.warn(`[CPU Monitor] Threshold reached: ${cpuPercentage.toFixed(2)}%`);
        await onThresholdExceeded(latest);
      }
    } catch (error) {
      logger.error('[CPU Monitor] Monitoring error:', error.message);
    }
    return latest;
  }

  timer = setInterval(check, intervalMs);
  timer.unref();
  logger.log(`[CPU Monitor] Started. Threshold=${threshold}% Interval=${intervalMs}ms`);
  return { stop, check, getMetrics: () => latest };
}

module.exports = { startCpuMonitor, createCpuSampler, CPU_THRESHOLD, CPU_CHECK_INTERVAL };
