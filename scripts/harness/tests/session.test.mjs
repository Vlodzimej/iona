import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { worktreePatch, worktreeStatus } from '../../agent/lib/worktree.mjs';
import { loadHarnessProfile } from '../lib/profile.mjs';
import { projectRunnerDescriptor } from '../lib/dependencies.mjs';
import { registerRepository, repositoryStateRoot } from '../lib/registry.mjs';
import { HarnessSessionManager } from '../lib/session.mjs';
import { decideHarnessApproval } from '../lib/store.mjs';
import { harnessRoot } from '../lib/paths.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function repository() {
  const root = mkdtempSync(resolve(tmpdir(), 'ionic-harness-target-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Harness Test');
  git(root, 'config', 'user.email', 'harness@example.invalid');
  mkdirSync(resolve(root, 'src'));
  writeFileSync(resolve(root, 'src/app.ts'), 'export const value = 1;\n');
  writeFileSync(resolve(root, 'package.json'), '{"scripts":{}}\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  return root;
}

function fakeExecutor(context) {
  function hash() {
    return createHash('sha256').update(worktreePatch(context.worktreeRoot)).digest('hex');
  }
  return {
    type: 'test',
    applyPatch(patch) {
      execFileSync('git', ['apply', '--check', '--whitespace=error-all', '-'], {
        cwd: context.worktreeRoot,
        input: patch,
      });
      execFileSync('git', ['apply', '--whitespace=nowarn', '-'], {
        cwd: context.worktreeRoot,
        input: patch,
      });
      return { ok: true };
    },
    runChecks(profile) {
      return { ok: true, executor: 'test', profile, patchHash: hash(), results: [] };
    },
    patchHash: hash,
    status: () => worktreeStatus(context.worktreeRoot),
  };
}

function managerFor(stateRoot, repositoryId) {
  return new HarnessSessionManager({
    harnessRoot,
    stateRoot,
    repositoryId,
    profileId: 'angular-ionic-capacitor',
    profile: loadHarnessProfile(harnessRoot, 'angular-ionic-capacitor'),
    executor: 'docker',
    executorFactory: fakeExecutor,
    runnerPreparer: () => ({ image: 'test-runner:latest', digest: 'test-digest', cached: true }),
  });
}

test('external harness keeps state outside target and applies only a sealed patch', (context) => {
  const targetRoot = repository();
  const stateRoot = mkdtempSync(resolve(tmpdir(), 'ionic-harness-state-'));
  context.after(() => {
    rmSync(targetRoot, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  });
  const entry = registerRepository(stateRoot, targetRoot);
  const manager = managerFor(stateRoot, entry.id);
  const run = manager.begin('Update the application value.');
  const internal = manager.status(run.runId, { includeInternalPaths: true });

  assert.equal(run.status, 'active');
  assert.equal(run.worktreeRoot, undefined);
  assert.equal(internal.worktreeRoot.startsWith(targetRoot), false);
  assert.deepEqual(manager.execute(run.runId, 'list_files', {}).files, [
    'package.json',
    'src/app.ts',
  ]);
  assert.match(
    manager.execute(run.runId, 'read_file', { path: 'src/app.ts' }).content,
    /value = 1/u,
  );

  const patch = [
    'diff --git a/src/app.ts b/src/app.ts',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 2;',
    '',
  ].join('\n');
  assert.equal(manager.execute(run.runId, 'apply_patch', { patch }).ok, true);
  const finished = manager.finish(run.runId, 'Updated the application value.');
  assert.equal(finished.status, 'ready');
  assert.equal(finished.patch, undefined);
  assert.match(manager.status(run.runId, { includePatch: true }).patch, /value = 2/u);
  assert.equal(
    readFileSync(resolve(targetRoot, 'src/app.ts'), 'utf8'),
    'export const value = 1;\n',
  );

  assert.equal(manager.apply(run.runId).status, 'applied');
  assert.equal(
    readFileSync(resolve(targetRoot, 'src/app.ts'), 'utf8'),
    'export const value = 2;\n',
  );
});

test('repository registration rejects overlapping target and state roots', (context) => {
  const targetRoot = repository();
  context.after(() => rmSync(targetRoot, { recursive: true, force: true }));
  assert.throws(
    () => registerRepository(resolve(targetRoot, '.harness-state'), targetRoot),
    /must not overlap/u,
  );
});

test('unchanged run finishes without preparing a project runner or running checks', (context) => {
  const targetRoot = repository();
  const stateRoot = mkdtempSync(resolve(tmpdir(), 'ionic-harness-state-'));
  context.after(() => {
    rmSync(targetRoot, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  });
  const entry = registerRepository(stateRoot, targetRoot);
  const manager = new HarnessSessionManager({
    harnessRoot,
    stateRoot,
    repositoryId: entry.id,
    profileId: 'angular-ionic-capacitor',
    profile: loadHarnessProfile(harnessRoot, 'angular-ionic-capacitor'),
    executor: 'docker',
    executorFactory: () => {
      throw new Error('Executor must not be created for an unchanged run.');
    },
    runnerPreparer: () => {
      throw new Error('Runner must not be prepared for an unchanged run.');
    },
  });

  const run = manager.begin('Inspect the application.');
  const finished = manager.finish(run.runId, 'Inspection completed.');

  assert.equal(finished.status, 'ready');
  assert.equal(finished.validation.ok, true);
  assert.equal(finished.validation.profile, 'unchanged');
});

test('project runner identity is pinned to manifests and trusted runner sources', (context) => {
  const targetRoot = repository();
  context.after(() => rmSync(targetRoot, { recursive: true, force: true }));
  writeFileSync(
    resolve(targetRoot, 'package-lock.json'),
    JSON.stringify({
      name: 'runner-fixture',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: 'runner-fixture', version: '1.0.0' } },
    }) + '\n',
  );
  const first = projectRunnerDescriptor(harnessRoot, targetRoot);
  const second = projectRunnerDescriptor(harnessRoot, targetRoot);
  assert.equal(first.digest, second.digest);
  assert.equal(first.image, second.image);
  writeFileSync(resolve(targetRoot, 'package.json'), '{"scripts":{},"version":"2.0.0"}\n');
  assert.notEqual(projectRunnerDescriptor(harnessRoot, targetRoot).digest, first.digest);
});

test('protected patch requires a persisted exact approval before it can be applied', (context) => {
  const targetRoot = repository();
  const stateRoot = mkdtempSync(resolve(tmpdir(), 'ionic-harness-state-'));
  context.after(() => {
    rmSync(targetRoot, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  });
  const entry = registerRepository(stateRoot, targetRoot);
  const manager = managerFor(stateRoot, entry.id);
  const run = manager.begin('Add a package script.');
  const patch = [
    'diff --git a/package.json b/package.json',
    '--- a/package.json',
    '+++ b/package.json',
    '@@ -1 +1 @@',
    '-{"scripts":{}}',
    '+{"scripts":{"check":"echo checked"}}',
    '',
  ].join('\n');

  const waiting = manager.execute(run.runId, 'apply_patch', { patch });
  assert.equal(waiting.status, 'waiting_approval');
  assert.deepEqual(waiting.approval.paths, ['package.json']);
  decideHarnessApproval(
    repositoryStateRoot(stateRoot, entry.id),
    waiting.approval.id,
    'approved',
    'test-user',
  );
  assert.equal(manager.execute(run.runId, 'apply_patch', { patch }).ok, true);
  assert.equal(manager.status(run.runId).approval, null);
});

test(
  'real Docker Executor reads external config and validates an external worktree',
  { skip: process.env.LOCAL_HARNESS_DOCKER_INTEGRATION !== '1', timeout: 180_000 },
  (context) => {
    const targetRoot = repository();
    const stateRoot = mkdtempSync(resolve(tmpdir(), 'ionic-harness-docker-state-'));
    context.after(() => {
      rmSync(targetRoot, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    });
    writeFileSync(
      resolve(targetRoot, 'package.json'),
      JSON.stringify({
        name: 'docker-runner-fixture',
        version: '1.0.0',
        scripts: {
          'format:check': 'node -e "process.exit(0)"',
          build: 'node -e "process.exit(0)"',
          test: 'node -e "process.exit(0)" --',
          'cap:check': 'node -e "process.exit(0)"',
          'ai:doctor': 'node -e "process.exit(0)"',
          'agent:test': 'node -e "process.exit(0)"',
        },
      }) + '\n',
    );
    writeFileSync(
      resolve(targetRoot, 'package-lock.json'),
      JSON.stringify({
        name: 'docker-runner-fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: { '': { name: 'docker-runner-fixture', version: '1.0.0' } },
      }) + '\n',
    );
    git(targetRoot, 'add', 'package.json', 'package-lock.json');
    git(targetRoot, 'commit', '-m', 'add validation scripts');
    const entry = registerRepository(stateRoot, targetRoot);
    const manager = new HarnessSessionManager({
      harnessRoot,
      stateRoot,
      repositoryId: entry.id,
      profileId: 'angular-ionic-capacitor',
      executor: 'docker',
    });
    const run = manager.begin('Update a source file through Docker.');
    const patch = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1 +1 @@',
      '-export const value = 1;',
      '+export const value = 3;',
      '',
    ].join('\n');
    assert.equal(manager.execute(run.runId, 'apply_patch', { patch }).ok, true);
    const finished = manager.finish(run.runId, 'Validated with the real Docker Executor.');
    assert.equal(finished.status, 'ready');
    assert.equal(finished.validation.executor, 'docker');
    manager.discard(run.runId);
  },
);
