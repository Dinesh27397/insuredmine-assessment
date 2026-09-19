const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { readInputFile } = require('../src/utils/importFile.helper');
const { normalizeRow } = require('../src/utils/utils.helper');
const builders = require('../src/utils/bulkOperation.helper');
const { persistImport } = require('../src/services/import.service');
const { importPolicyData } = require('../src/controllers/import.controller');

async function fixture(t, filename, content) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'insuredmine-import-test-'));
  const filePath = path.join(directory, filename);
  if (content !== undefined) await fs.writeFile(filePath, content);
  t.after(async () => {
    for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
    await fs.rmdir(directory);
  });
  return filePath;
}

function prepare(rows) {
  return {
    rows,
    operations: {
      agents: builders.buildAgentOperations(rows),
      accounts: builders.buildAccountOperations(rows),
      lobs: builders.buildLobOperations(rows),
      carriers: builders.buildCarrierOperations(rows),
      users: builders.buildUserOperations(rows)
    }
  };
}

function fakeModels() {
  const calls = [];
  const models = {};
  for (const name of ['agents', 'accounts', 'lobs', 'carriers', 'users', 'policies']) {
    const documents = new Map();
    models[name] = {
      documents,
      async bulkWrite(operations, options) {
        calls.push({ type: 'write', name, options, operations });
        const upsertedIds = {};
        let index = 0;
        for (const { updateOne: operation } of operations) {
          const key = Object.values(operation.filter)[0];
          const existing = documents.get(key) || { _id: `${name}-${documents.size}` };
          if (!documents.has(key)) upsertedIds[index] = existing._id;
          documents.set(key, { ...existing, ...operation.update.$set });
          index++;
        }
        return { upsertedIds };
      },
      find(filter, projection) {
        calls.push({ type: 'find', name, filter, projection });
        assert.equal(Object.keys(filter).length, 1, 'lookup must be scoped to this file');
        const [key, { $in: values }] = Object.entries(filter)[0];
        assert.ok(Array.isArray(values));
        assert.equal(projection[key], 1);
        assert.equal(projection._id, 1);
        assert.equal(projection.updatedAt, undefined);
        return { lean: async () => [...documents.values()].filter(item => values.includes(item[key])) };
      }
    };
  }
  return { models, calls };
}

test('CSV supports BOM, quoted values, dates and leading zero identifiers without loading XLSX', async t => {
  const filePath = await fixture(t, 'input.csv', '\uFEFFagent,firstname,email,account_name,category_name,company_name,policy_number,premium_amount,zip,phone,policy_start_date,address\r\nAgent,Alice,ALICE@example.test,Account,Auto,Carrier,000123,"$1,234.50",00123,0123456789,2026-01-02,"Line one\nLine two"\r\n');
  const rows = await readInputFile(filePath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'alice@example.test');
  assert.equal(rows[0].agentName, 'Agent');
  assert.equal(rows[0].policyNumber, '000123');
  assert.equal(rows[0].zipCode, '00123');
  assert.equal(rows[0].phoneNumber, '0123456789');
  assert.equal(rows[0].premiumAmount, 1234.5);
  assert.equal(rows[0].policyStartDate.toISOString(), '2026-01-02T00:00:00.000Z');
  assert.equal(rows[0].address, 'Line one\nLine two');
  assert.equal(require.cache[require.resolve('xlsx')], undefined);
});

for (const extension of ['xlsx', 'xls']) {
  test(`${extension} parses the first worksheet and Excel dates`, async t => {
    const XLSX = require('xlsx');
    const filePath = await fixture(t, `input.${extension}`);
    const workbook = XLSX.utils.book_new();
    const date = new Date('2026-01-02T00:00:00.000Z');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
      { email: 'ALICE@example.test', policy_number: 'P1', dob: 46024, premium_amount: 0 }
    ]), 'Policies');
    XLSX.writeFile(workbook, filePath);
    const [row] = await readInputFile(filePath);
    assert.equal(row.email, 'alice@example.test');
    assert.equal(row.policyNumber, 'P1');
    assert.equal(row.dob.getTime(), date.getTime());
    assert.equal(row.premiumAmount, 0);
  });
}

test('missing and unsupported files reject promptly', async () => {
  await assert.rejects(readInputFile(path.join(os.tmpdir(), 'nonexistent-import-fixture.csv')), { code: 'ENOENT' });
  await assert.rejects(readInputFile('unsupported.txt'), /Unsupported file format/);
});

test('worker prepares imports without connecting to MongoDB and returns boolean errors', async t => {
  const filePath = await fixture(t, 'input.csv', 'email,policy_number\na@example.test,P1\n');
  for (const [input, success] of [[filePath, true], [`${filePath}.missing`, false]]) {
    const worker = new Worker(path.join(__dirname, '../src/workers/import.worker.js'), {
      workerData: { filePath: input },
      env: { ...process.env, MONGODB_URI: 'invalid://must-not-connect' }
    });
    const result = await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    await worker.terminate();
    assert.equal(result.success, success);
    if (success) assert.equal(result.data.rows.length, 1);
    else assert.match(result.message, /Unsupported file format/);
  }
});

test('imports are idempotent, retain references, and update duplicate policies deterministically', async () => {
  const row = normalizeRow({ agent: 'Agent', account_name: 'Account', email: 'ALICE@example.test', category_name: 'Auto', company_name: 'Carrier', policy_number: 'P1', premium_amount: 10 });
  const { models, calls } = fakeModels();
  const prepared = prepare([row, { ...row, premiumAmount: 20 }, { ...row, policyNumber: 'p1' }]);
  await persistImport(prepared, models);
  const originalIds = [...models.policies.documents.values()].map(item => item._id);
  const result = await persistImport(prepared, models);
  assert.equal(result.imported.rows, 3);
  assert.equal(result.imported.users, 1);
  assert.equal(result.imported.policies, 2);
  assert.deepEqual([...models.policies.documents.values()].map(item => item._id), originalIds);
  const policy = models.policies.documents.get('P1');
  assert.equal(policy.premiumAmount, 20);
  assert.equal(policy.userId, models.users.documents.get('alice@example.test')._id);
  assert.equal(policy.categoryId, models.lobs.documents.get('Auto')._id);
  assert.equal(policy.companyId, models.carriers.documents.get('Carrier')._id);
  const lookups = calls.filter(call => call.type === 'find');
  assert.equal(lookups.length, 12);
  assert.ok(Object.values(result.databaseWrites).every(count => count === 0));
  assert.equal(calls.filter(call => call.type === 'write').length, 6);
  assert.ok(calls.filter(call => call.type === 'write').every(call => call.options.ordered === false && call.options.throwOnValidationError));

  const changed = await persistImport(prepare([{ ...row, premiumAmount: 35, firstName: 'Updated' }]), models);
  assert.equal(changed.databaseWrites.users, 1);
  assert.equal(changed.databaseWrites.policies, 1);
  assert.equal(changed.databaseWrites.accounts, 0);
  assert.equal(models.policies.documents.get('P1').premiumAmount, 35);
  assert.equal(models.users.documents.get('alice@example.test').firstName, 'Updated');
});

test('empty imports make no database calls', async () => {
  const { models, calls } = fakeModels();
  const result = await persistImport(prepare([]), models);
  assert.equal(result.imported.rows, 0);
  assert.equal(calls.length, 0);
});

test('resolves IDs when a concurrent upsert matched a record created after the lookup', async () => {
  const { models, calls } = fakeModels();
  const writeUsers = models.users.bulkWrite;
  models.users.bulkWrite = async (...args) => {
    await writeUsers(...args);
    return { upsertedIds: {} };
  };
  const row = normalizeRow({ email: 'concurrent@example.test', policy_number: 'P1' });
  await persistImport(prepare([row]), models);
  assert.equal(calls.filter(call => call.type === 'find' && call.name === 'users').length, 2);
  assert.equal(models.policies.documents.get('P1').userId, models.users.documents.get(row.email)._id);
});

test('reference write failures are surfaced before writing policies', async () => {
  const { models, calls } = fakeModels();
  models.users.bulkWrite = async () => { throw new Error('Database write failed'); };
  const rows = [normalizeRow({ email: 'a@example.test', policy_number: 'P1' })];
  await assert.rejects(persistImport(prepare(rows), models), /Database write failed/);
  assert.ok(!calls.some(call => call.name === 'policies'));
});

test('controller reports missing uploads and worker failures as errors', async () => {
  const respond = req => new Promise(resolve => {
    const res = {
      headersSent: false,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.headersSent = true; resolve({ code: this.statusCode, body }); }
    };
    importPolicyData(req, res);
  });
  assert.equal((await respond({})).code, 400);
  const failure = await respond({ file: { path: 'unsupported.txt' } });
  assert.equal(failure.code, 500);
  assert.equal(failure.body.success, false);
});
