import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  applyWorktreePatch,
  createAgentWorktree,
  removeAgentWorktree,
  worktreePatch,
} from '../lib/worktree.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function repository() {
  const root = mkdtempSync(resolve(tmpdir(), 'ionic-agent-worktree-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Agent Test');
  git(root, 'config', 'user.email', 'agent@example.invalid');
  writeFileSync(resolve(root, '.gitignore'), '.agent\n');
  mkdirSync(resolve(root, 'src'));
  writeFileSync(resolve(root, 'src/app.ts'), 'export const value = 1;\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  return root;
}

test('worktree changes can be reviewed and explicitly applied to the primary checkout', (context) => {
  const root = repository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const run = createAgentWorktree(root, 'successful-run');
  writeFileSync(resolve(run.worktreeRoot, 'src/app.ts'), 'export const value = 2;\n');
  assert.match(worktreePatch(run.worktreeRoot), /value = 2/u);
  assert.equal(applyWorktreePatch(root, run.worktreeRoot), true);
  assert.match(git(root, 'diff'), /value = 2/u);
  removeAgentWorktree(root, run.worktreeRoot);
});

test('failed worktree setup removes the linked-worktree registration', (context) => {
  const root = repository();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, 'node_modules'));
  writeFileSync(resolve(root, 'node_modules/tracked.txt'), 'fixture\n');
  git(root, 'add', '-f', 'node_modules/tracked.txt');
  git(root, 'commit', '-m', 'tracked dependency fixture');

  assert.throws(() => createAgentWorktree(root, 'failed-run'), /EEXIST/u);
  const worktreeRoot = resolve(root, '.agent/worktrees/failed-run');
  assert.equal(existsSync(worktreeRoot), false);
  assert.doesNotMatch(git(root, 'worktree', 'list', '--porcelain'), /failed-run/u);
});
