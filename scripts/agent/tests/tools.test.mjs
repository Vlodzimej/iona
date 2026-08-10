import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { createAgentTools, sandboxProfile } from '../lib/tools.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'ionic-agent-tools-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Agent Test');
  git(root, 'config', 'user.email', 'agent@example.invalid');
  mkdirSync(resolve(root, 'src'));
  writeFileSync(resolve(root, 'src/app.ts'), 'export const value = 1;\n');
  writeFileSync(resolve(root, 'package.json'), '{"scripts":{}}\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  return root;
}

const config = {
  maximumToolCalls: 20,
  maximumToolOutputBytes: 10000,
  maximumReadBytes: 10000,
  maximumPatchBytes: 10000,
  maximumChangedFiles: 5,
  checkTimeoutMs: 10000,
  searchTimeoutMs: 10000,
  allowedWritePatterns: ['src/**'],
  protectedWritePatterns: ['package.json'],
  deniedPatterns: ['.git/**', '.env*', 'node_modules/**'],
  checks: {},
};

test('tools read, search, patch, and report a repository diff', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const tools = createAgentTools({
    config,
    worktreeRoot: root,
    allowProtected: false,
    allowHostExecution: false,
  });

  assert.deepEqual(tools.execute('list_files', {}).files, ['package.json', 'src/app.ts']);
  assert.match(tools.execute('read_file', { path: 'src/app.ts' }).content, /value = 1/u);
  if (spawnSync('rg', ['--version']).status === 0) {
    assert.match(tools.execute('search', { query: 'value' }).matches[0], /src\/app\.ts/u);
  }

  const patch = [
    'diff --git a/src/app.ts b/src/app.ts',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 2;',
    '',
  ].join('\n');
  assert.equal(tools.execute('apply_patch', { patch }).ok, true);
  assert.match(tools.execute('git_diff', {}).diff, /value = 2/u);
});

test('protected and denied patch targets cannot bypass policy', (context) => {
  const root = fixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const tools = createAgentTools({
    config,
    worktreeRoot: root,
    allowProtected: false,
    allowHostExecution: false,
  });
  const protectedPatch = [
    'diff --git a/package.json b/package.json',
    '--- a/package.json',
    '+++ b/package.json',
    '@@ -1 +1 @@',
    '-{"scripts":{}}',
    '+{"scripts":{"x":"echo x"}}',
    '',
  ].join('\n');
  assert.throws(
    () => tools.execute('apply_patch', { patch: protectedPatch }),
    /approval_required/u,
  );
  assert.throws(() => tools.execute('read_file', { path: '.env.local' }), /denied/u);
  assert.throws(() => tools.execute('search', { query: 'secret', glob: '.env*' }), /denied path/u);
});

test('macOS sandbox profile denies by default and grants writes only to isolated roots', () => {
  const profile = sandboxProfile('/private/tmp/example-worktree');
  assert.match(profile, /\(deny default\)/u);
  assert.doesNotMatch(profile, /allow network/u);
  assert.match(profile, /example-worktree/u);
  assert.doesNotMatch(profile, /\(allow file-read\*\)\s*$/mu);
});
