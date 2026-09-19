const Agent = require('../models/agent');
const Account = require('../models/Account');
const LOB = require('../models/Lob');
const Carrier = require('../models/Carrier');
const User = require('../models/user');
const Policy = require('../models/Policy');
const { buildPolicyOperations } = require('../utils/bulkOperation.helper');

const defaultModels = { agents: Agent, accounts: Account, lobs: LOB, carriers: Carrier, users: User, policies: Policy };
const referenceKeys = {
  agents: 'agentName',
  accounts: 'accountName',
  lobs: 'categoryName',
  carriers: 'companyName',
  users: 'email'
};
const bulkOptions = { ordered: false, throwOnValidationError: true };

function sameValue(stored, incoming) {
  if (stored instanceof Date && incoming instanceof Date) {
    return stored.getTime() === incoming.getTime();
  }
  if (stored?._bsontype === 'ObjectId' && incoming?._bsontype === 'ObjectId') {
    return stored.equals(incoming);
  }
  return stored === incoming;
}

async function syncOperations(model, operations, key, needsIds = false) {
  if (!operations.length) return { ids: new Map(), written: 0 };

  const values = operations.map(operation => operation.updateOne.filter[key]);
  const projection = { [key]: 1, _id: 1 };
  for (const { updateOne } of operations) {
    for (const field of Object.keys(updateOne.update.$set)) projection[field] = 1;
  }
  const documents = await model.find({ [key]: { $in: values } }, projection).lean();
  const existing = new Map(documents.map(document => [document[key], document]));
  const ids = new Map(documents.map(document => [document[key].toLowerCase(), document._id]));
  const changed = operations.filter(({ updateOne }) => {
    const stored = existing.get(updateOne.filter[key]);
    return !stored || Object.entries(updateOne.update.$set).some(
      ([field, value]) => value !== undefined && !sameValue(stored[field], value)
    );
  });

  if (changed.length) {
    const result = await model.bulkWrite(changed, bulkOptions);
    for (const [index, id] of Object.entries(result.upsertedIds || {})) {
      ids.set(changed[Number(index)].updateOne.filter[key].toLowerCase(), id);
    }
  }

  if (needsIds) {
    // A concurrent import can match a record inserted after our initial read.
    const missing = values.filter(value => !ids.has(value.toLowerCase()));
    if (missing.length) {
      const inserted = await model.find(
        { [key]: { $in: missing } }, { [key]: 1, _id: 1 }
      ).lean();
      for (const document of inserted) ids.set(document[key].toLowerCase(), document._id);
    }
  }

  return { ids, written: changed.length };
}

async function persistImport({ rows, operations }, models = defaultModels) {
  // Read the current database state for every upload; no stale in-memory cache.
  // File parsing stays in the worker and database I/O reuses the server's pool.
  const referenceStart = performance.now();
  const entries = Object.entries(operations);
  const results = await Promise.allSettled(entries.map(([name, batch]) =>
    syncOperations(models[name], batch, referenceKeys[name], ['users', 'lobs', 'carriers'].includes(name))
  ));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const references = Object.fromEntries(entries.map(([name], index) => [name, results[index].value]));
  const referenceSyncMs = performance.now() - referenceStart;

  const policyStart = performance.now();
  const policyOps = buildPolicyOperations(rows, {
    userMap: references.users.ids,
    lobMap: references.lobs.ids,
    carrierMap: references.carriers.ids
  });
  const policies = await syncOperations(models.policies, policyOps, 'policyNumber');

  return {
    imported: {
      rows: rows.length,
      ...Object.fromEntries(entries.map(([name, batch]) => [name, batch.length])),
      policies: policyOps.length
    },
    databaseWrites: {
      ...Object.fromEntries(entries.map(([name]) => [name, references[name].written])),
      policies: policies.written
    },
    timings: {
      referenceSyncMs: Number(referenceSyncMs.toFixed(2)),
      policySyncMs: Number((performance.now() - policyStart).toFixed(2))
    }
  };
}

module.exports = { persistImport };
