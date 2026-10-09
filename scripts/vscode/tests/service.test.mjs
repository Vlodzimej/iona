import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { ExtensionService } from '../service.mjs';
import { HarnessSessionManager } from '../../harness/lib/session.mjs';
import { worktreePatch, worktreeStatus } from '../../agent/lib/worktree.mjs';
const config = {
  provider: 'ollama',
  pairEngine: 'ollama',
  model: 'fixture',
  maximumTokens: 100,
  temperature: 0,
  timeoutMs: 1000,
};
const git = (root, ...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
function fixture(context) {
  const root = mkdtempSync(resolve(tmpdir(), 'vscode-service-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = resolve(root, 'target');
  mkdirSync(repository);
  git(repository, 'init', '-b', 'main');
  git(repository, 'config', 'user.name', 'Test');
  git(repository, 'config', 'user.email', 'test@example.invalid');
  mkdirSync(resolve(repository, 'src'));
  writeFileSync(resolve(repository, 'src/value.ts'), 'export const value = 1;\n');
  writeFileSync(resolve(repository, 'package.json'), '{"scripts":{}}\n');
  writeFileSync(resolve(repository, 'package-lock.json'), '{}\n');
  git(repository, 'add', '.');
  git(repository, 'commit', '-m', 'fixture');
  const executorFactory = (context) => {
    const hash = () =>
      createHash('sha256').update(worktreePatch(context.worktreeRoot)).digest('hex');
    return {
      applyPatch(patch) {
        execFileSync('git', ['apply', '--check', '-'], { cwd: context.worktreeRoot, input: patch });
        execFileSync('git', ['apply', '-'], { cwd: context.worktreeRoot, input: patch });
        return { ok: true };
      },
      runChecks: (profile) => ({ ok: true, profile, patchHash: hash(), results: [] }),
      patchHash: hash,
      status: () => worktreeStatus(context.worktreeRoot),
    };
  };
  const options = {
    stateRoot: resolve(root, 'state'),
    contextBuilder: () => ({ skills: [] }),
    sessionFactory: (options) =>
      new HarnessSessionManager({
        ...options,
        executorFactory,
        runnerPreparer: () => ({ image: 'test:latest', digest: 'test', cached: true }),
      }),
  };
  return { repository, options };
}
function call(name, args) {
  return {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [
            {
              id: 'test-call',
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}
function patch(path, before, after) {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${before}\n+${after}\n`;
}

test('agent changes stay isolated until the validated run is explicitly applied', async (context) => {
  const { repository, options } = fixture(context);
  const requests = [
    call('apply_patch', {
      patch: patch('src/value.ts', 'export const value = 1;', 'export const value = 2;'),
    }),
    call('finish', { summary: 'Changed value.' }),
  ];
  const service = new ExtensionService({ ...options, complete: async () => requests.shift() });
  const run = await service.handle('start', { repository, task: 'Update value', config });
  assert.equal(run.status, 'ready');
  assert.equal(
    readFileSync(resolve(repository, 'src/value.ts'), 'utf8'),
    'export const value = 1;\n',
  );
  assert.match((await service.handle('diff', { repository, runId: run.runId })).patch, /value = 2/);
  assert.equal((await service.handle('apply', { repository, runId: run.runId })).status, 'applied');
  assert.equal(
    readFileSync(resolve(repository, 'src/value.ts'), 'utf8'),
    'export const value = 2;\n',
  );
});

test('plain final agent response implicitly finishes and validates the run', async (context) => {
  const { repository, options } = fixture(context);
  const service = new ExtensionService({
    ...options,
    complete: async () => ({
      choices: [{ finish_reason: 'stop', message: { content: 'Inspection completed.' } }],
    }),
  });

  const run = await service.handle('start', { repository, task: 'Inspect', config });

  assert.equal(run.status, 'ready');
  assert.equal(run.summary, 'Inspection completed.');
  assert.equal(run.text, 'Inspection completed.');
});

test('protected approval can be reviewed and resumed after bridge restart; mismatched review is rejected', async (context) => {
  const { repository, options } = fixture(context);
  const protectedPatch = patch(
    'package.json',
    '{"scripts":{}}',
    '{"scripts":{},"version":"1.0.0"}',
  );
  const service = new ExtensionService({
    ...options,
    complete: async () => call('apply_patch', { patch: protectedPatch }),
  });
  const run = await service.handle('start', { repository, task: 'Update version', config });
  assert.equal(run.status, 'waiting_approval');
  const restarted = new ExtensionService({
    ...options,
    complete: async () => call('finish', { summary: 'Updated version.' }),
  });
  const params = { repository, runId: run.runId };
  const review = await restarted.handle('approval', params);
  assert.equal(review.patch, protectedPatch);
  await assert.rejects(
    restarted.handle('decide', {
      ...params,
      approvalId: review.approvalId,
      decision: 'approved',
      hash: 'wrong',
    }),
    /exact patch/,
  );
  await restarted.handle('decide', {
    ...params,
    approvalId: review.approvalId,
    decision: 'approved',
    hash: review.hash,
  });
  assert.equal((await restarted.handle('continue', { ...params, config })).status, 'ready');
  assert.equal(readFileSync(resolve(repository, 'package.json'), 'utf8'), '{"scripts":{}}\n');
});

test('chat includes no project files and ignores hidden reasoning fields', async (context) => {
  const { options } = fixture(context);
  const service = new ExtensionService({
    ...options,
    stream: async (_, messages) => {
      assert.equal(messages.length, 2);
      assert.doesNotMatch(JSON.stringify(messages), /src\/value/);
      return {
        choices: [{ message: { content: 'Answer', reasoning_content: 'Private reasoning' } }],
      };
    },
  });
  assert.deepEqual(await service.handle('chat', { task: 'Question', config }), { text: 'Answer' });
});

test('extension agent denies lockfiles and unknown tools without executing model commands', async (context) => {
  const { repository, options } = fixture(context);
  const outputs = [];
  const requests = [
    call('read_file', { path: 'package-lock.json' }),
    call('shell', { command: 'touch forbidden' }),
    call('finish', { summary: 'No changes.' }),
  ];
  const service = new ExtensionService({
    ...options,
    emit: (event) => outputs.push(JSON.stringify(event)),
    complete: async (_, messages) => {
      outputs.push(JSON.stringify(messages));
      return requests.shift();
    },
  });
  await service.handle('start', { repository, task: 'Inspect', config });
  assert.ok(outputs.some((output) => output.includes('Tool rejected')));
  assert.ok(outputs.some((output) => output.includes('Reviewing shell result')));
  assert.equal(git(repository, 'status', '--porcelain'), '');
});

test('explicit selected context is bounded and excludes lockfiles', async (context) => {
  const { repository, options } = fixture(context);
  const service = new ExtensionService({
    ...options,
    stream: async (_, messages) => {
      assert.match(messages.at(-1).content, /Explicitly selected repository excerpt/);
      assert.match(messages.at(-1).content, /src\/value.ts/);
      return { choices: [{ message: { content: 'Answer' } }] };
    },
  });
  const params = {
    task: 'Explain',
    config,
    selection: {
      repository,
      path: resolve(repository, 'src/value.ts'),
      content: 'export const value = 1;',
    },
  };
  assert.equal((await service.handle('chat', params)).text, 'Answer');
  await assert.rejects(
    service.handle('chat', {
      ...params,
      selection: { ...params.selection, path: resolve(repository, 'package-lock.json') },
    }),
    /not allowed/,
  );
  await assert.rejects(
    service.handle('chat', {
      ...params,
      selection: { ...params.selection, content: 'x'.repeat(12001) },
    }),
    /12,000/,
  );
});
