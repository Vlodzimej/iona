import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { harnessRoot } from '../lib/paths.mjs';

test('user-scoped harness CLI exposes the external-project workflow', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(harnessRoot, 'scripts/harness/cli.mjs'), '--help'],
    {
      cwd: harnessRoot,
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /doctor --repo PATH/u);
  assert.match(result.stdout, /opencode --repo PATH/u);
  assert.match(result.stdout, /apply REPOSITORY RUN/u);
  assert.match(result.stdout, /remain outside the target repository/u);
});

test('user-scoped harness CLI rejects unknown commands', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(harnessRoot, 'scripts/harness/cli.mjs'), 'unknown-command'],
    { cwd: harnessRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown harness command/u);
});
