import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentApi } from '../api.mjs';

const token = 'a-secure-test-token-with-more-than-32-characters';
const config = {
  api: { maximumBodyBytes: 1000, maximumConcurrentRuns: 1 },
};

async function listen(server) {
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  return 'http://127.0.0.1:' + server.address().port;
}

test('Agent API requires a bearer token and forces remote runs into Docker review mode', async (context) => {
  let received;
  let release;
  const blocked = new Promise((resolvePromise) => {
    release = resolvePromise;
  });
  const server = createAgentApi({
    config,
    token,
    run: async (task, options) => {
      received = { task, options };
      await blocked;
    },
    status: (runId) => ({ runId, status: 'running' }),
    resume: async () => {},
    decide: () => ({ id: 'approval-1', runId: 'run-1', status: 'approved' }),
  });
  context.after(() => server.close());
  const baseUrl = await listen(server);

  assert.equal((await fetch(baseUrl + '/health')).status, 200);
  assert.equal((await fetch(baseUrl + '/v1/runs/run-1')).status, 401);
  const response = await fetch(baseUrl + '/v1/runs', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'Inspect the application' }),
  });
  assert.equal(response.status, 202);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(received.task, 'Inspect the application');
  assert.equal(received.options.executor, 'docker');
  assert.equal(received.options.apply, false);
  assert.equal(received.options.allowProtected, false);

  const limited = await fetch(baseUrl + '/v1/runs', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'Second run' }),
  });
  assert.equal(limited.status, 429);
  release();
});

test('Agent API rejects short authentication secrets', () => {
  assert.throws(() => createAgentApi({ config, token: 'short' }), /at least 32/u);
});
