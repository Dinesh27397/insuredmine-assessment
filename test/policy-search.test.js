const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const User = require('../src/models/user');
const policyRoutes = require('../src/routes/policy.routes');

test('username search normalizes input and returns matching policy information', async t => {
  const records = [
    { user: { firstName: 'Lura Lucca' }, policy: { policyNumber: 'P-100' } },
    { user: { firstName: "Pat O'Connor" }, policy: { policyNumber: 'P-200' } },
    { user: { firstName: 'Alex (Jr.)' }, policy: { policyNumber: 'P-300' } }
  ];
  let aggregateCalls = 0;
  t.mock.method(User, 'aggregate', async pipeline => {
    aggregateCalls++;
    const query = pipeline[0].$match.firstName;
    const pattern = new RegExp(query.$regex, query.$options);
    return records.filter(record => pattern.test(record.user.firstName));
  });

  const app = express();
  app.use('/api/policies', policyRoutes);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/policies/search`;

  for (const username of ['Lura Lucca', '  Lura Lucca  ', '"Lura Lucca "', "'Lura Lucca '", 'lura', 'LUCCA']) {
    const response = await fetch(`${baseUrl}?${new URLSearchParams({ username })}`);
    const body = await response.json();
    assert.equal(response.status, 200, username);
    assert.equal(body.count, 1, username);
    assert.equal(body.data[0].policy.policyNumber, 'P-100');
  }

  for (const username of ['.*', '[', 'Unknown User']) {
    const response = await fetch(`${baseUrl}?${new URLSearchParams({ username })}`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.count, 0, 'regex characters must be searched literally');
  }

  for (const username of ["O'Connor", 'Alex (Jr.)']) {
    const response = await fetch(`${baseUrl}?${new URLSearchParams({ username })}`);
    assert.equal((await response.json()).count, 1, username);
  }

  const callsBeforeInvalidRequests = aggregateCalls;
  for (const query of ['', '?username=', '?username=%20%20', '?username=%22%20%22', '?username=Lura&username=Lucca']) {
    const response = await fetch(baseUrl + query);
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).success, false);
  }
  assert.equal(aggregateCalls, callsBeforeInvalidRequests);
});
