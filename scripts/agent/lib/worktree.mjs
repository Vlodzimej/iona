import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  symlinkSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

function git(root, args, options = {}) {
  const output = execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    input: options.input,
    stdio: options.input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  });
  return options.trim === false ? output : output.trim();
}

export function assertCleanWorktree(root) {
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) {
    throw new Error(
      'The primary worktree must be clean before an agent run. Commit or stash current changes.',
    );
  }
}

export function createRunId() {
  const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return timestamp + '-' + randomBytes(3).toString('hex');
}

export function createAgentWorktree(projectRoot, runId = createRunId(), options = {}) {
  assertCleanWorktree(projectRoot);
  const agentRoot = resolve(projectRoot, '.agent');
  const worktreeRoot = resolve(agentRoot, 'worktrees', runId);
  const runRoot = resolve(agentRoot, 'runs', runId);
  mkdirSync(resolve(agentRoot, 'worktrees'), { recursive: true });
  mkdirSync(runRoot, { recursive: true, mode: 0o700 });
  git(projectRoot, ['worktree', 'add', '--detach', worktreeRoot, 'HEAD']);

  try {
    const dependencies = resolve(projectRoot, 'node_modules');
    if (existsSync(dependencies) && options.linkDependencies !== false) {
      symlinkSync(dependencies, resolve(worktreeRoot, 'node_modules'), 'dir');
    }

    const eventPath = resolve(runRoot, 'events.jsonl');
    const descriptor = openSync(eventPath, 'a', 0o600);
    closeSync(descriptor);
    chmodSync(eventPath, 0o600);
    return { runId, runRoot, eventPath, worktreeRoot };
  } catch (error) {
    try {
      git(projectRoot, ['worktree', 'remove', '--force', worktreeRoot]);
      git(projectRoot, ['worktree', 'prune']);
    } catch {
      // Preserve the original setup error.
    }
    throw error;
  }
}

export function appendRunEvent(eventPath, event) {
  appendFileSync(
    eventPath,
    JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n',
    'utf8',
  );
}

function markNewFilesForDiff(worktreeRoot) {
  const output = git(worktreeRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  const paths = output.split('\0').filter(Boolean);
  for (const filePath of paths) {
    git(worktreeRoot, ['add', '--intent-to-add', '--', filePath]);
  }
}

export function worktreePatch(worktreeRoot) {
  markNewFilesForDiff(worktreeRoot);
  return git(worktreeRoot, ['diff', '--binary', '--no-ext-diff', 'HEAD'], { trim: false });
}

export function worktreeStatus(worktreeRoot) {
  return git(worktreeRoot, ['status', '--short', '--untracked-files=all']);
}

export function applyWorktreePatch(projectRoot, worktreeRoot) {
  assertCleanWorktree(projectRoot);
  const patch = worktreePatch(worktreeRoot);
  if (!patch) {
    return false;
  }
  git(projectRoot, ['apply', '--check', '--whitespace=error-all', '-'], { input: patch });
  git(projectRoot, ['apply', '--whitespace=nowarn', '-'], { input: patch });
  return true;
}

export function removeAgentWorktree(projectRoot, worktreeRoot) {
  git(projectRoot, ['worktree', 'remove', '--force', worktreeRoot]);
  git(projectRoot, ['worktree', 'prune']);
}
