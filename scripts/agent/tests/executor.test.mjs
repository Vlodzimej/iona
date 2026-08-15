import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { dockerRunArguments } from '../lib/executors/docker.mjs';

test('Docker executor has no network, drops privileges, and mounts only explicit roots', (context) => {
  const worktreeRoot = mkdtempSync(resolve(tmpdir(), 'ionic-docker-executor-'));
  const runRoot = mkdtempSync(resolve(tmpdir(), 'ionic-docker-run-'));
  context.after(() => {
    rmSync(worktreeRoot, { recursive: true, force: true });
    rmSync(runRoot, { recursive: true, force: true });
  });
  const args = dockerRunArguments(
    {
      worktreeRoot,
      runRoot,
      config: {
        executor: {
          docker: {
            image: 'test-runner:node-26',
            workspace: '/workspace',
            network: 'none',
            cpus: 2,
            memory: '4g',
            pidsLimit: 256,
            temporaryStorage: '512m',
          },
        },
      },
    },
    'run-checks',
    ['fast'],
  );
  const joined = args.join(' ');
  assert.match(joined, /--network none/u);
  assert.match(joined, /--read-only/u);
  assert.match(joined, /--cap-drop ALL/u);
  assert.match(joined, /no-new-privileges/u);
  assert.match(joined, /--pids-limit 256/u);
  assert.match(joined, /dst=\/etc\/passwd,readonly/u);
  assert.match(joined, /dst=\/etc\/group,readonly/u);
  assert.match(joined, /dst=\/opt\/agent\/config\.json,readonly/u);
  assert.doesNotMatch(joined, /docker\.sock|\.env\.local-ai/u);
  assert.deepEqual(args.slice(-3), ['test-runner:node-26', 'run-checks', 'fast']);
});
