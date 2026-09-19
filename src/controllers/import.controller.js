const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { persistImport } = require('../services/import.service');

const importPolicyData = (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const requestId = crypto.randomUUID();
  const startTime = performance.now();
  let worker;
  try {
    worker = new Worker(path.join(__dirname, '../workers/import.worker.js'), {
      workerData: { filePath: req.file.path }
    });
  } catch (error) {
    return res.status(500).json({ success: false, requestId, message: error.message });
  }

  let preparationFinished = false;
  const fail = message => {
    if (!res.headersSent) res.status(500).json({ success: false, requestId, message });
  };

  worker.once('message', async result => {
    preparationFinished = true;
    if (result.success !== true) return fail(result.message);

    const preparationMs = performance.now() - startTime;
    try {
      const imported = await persistImport(result.data);
      const duration = performance.now() - startTime;
      res.status(200).json({
        success: true,
        data: {
          success: 'success',
          data: {
            threadId: result.data.threadId,
            imported: imported.imported,
            databaseWrites: imported.databaseWrites,
            processingTimeMs: Number(duration.toFixed(2)),
            timings: {
              workerPreparationMs: Number(preparationMs.toFixed(2)),
              readAndPrepareMs: result.data.readAndPrepareTimeMs,
              ...imported.timings
            }
          }
        }
      });
    } catch (error) {
      console.error(`[ImportController] ${requestId} Import error:`, error.message);
      fail(error.message);
    }
  });

  worker.once('error', error => {
    preparationFinished = true;
    console.error(`[ImportController] ${requestId} Worker error:`, error.message);
    fail('Worker error occurred');
  });

  worker.once('exit', code => {
    if (!preparationFinished) fail(`Worker stopped before completing the import (exit code ${code})`);
  });
};

module.exports = { importPolicyData };
