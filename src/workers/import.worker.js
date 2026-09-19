const { parentPort, workerData, threadId } = require('node:worker_threads');
const { readInputFile } = require('../utils/importFile.helper');
const {
  buildAgentOperations,
  buildAccountOperations,
  buildLobOperations,
  buildCarrierOperations,
  buildUserOperations
} = require('../utils/bulkOperation.helper');

async function prepareImport() {
  const startTime = performance.now();
  try {
    const rows = await readInputFile(workerData.filePath);
    parentPort.postMessage({
      success: true,
      data: {
        threadId,
        rows,
        operations: {
          agents: buildAgentOperations(rows),
          accounts: buildAccountOperations(rows),
          lobs: buildLobOperations(rows),
          carriers: buildCarrierOperations(rows),
          users: buildUserOperations(rows)
        },
        readAndPrepareTimeMs: Number((performance.now() - startTime).toFixed(2))
      }
    });
  } catch (error) {
    parentPort.postMessage({ success: false, message: error.message });
  }
}

prepareImport();
