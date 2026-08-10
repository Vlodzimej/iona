import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { globMatches, pathAccess, pathsFromPatch, safeAbsolutePath } from './policy.mjs';
import { approvalMatches, ApprovalRequiredError } from './approval.mjs';
import { worktreePatch, worktreeStatus } from './worktree.mjs';

function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    input: options.input,
    stdio: options.input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
}

function truncated(value, maximumBytes) {
  const buffer = Buffer.from(value ?? '', 'utf8');
  if (buffer.byteLength <= maximumBytes) {
    return value ?? '';
  }
  return buffer.subarray(0, maximumBytes).toString('utf8') + '\n<output truncated>';
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error('Expected an integer between ' + minimum + ' and ' + maximum + '.');
  }
  return value;
}

function repositoryFiles(root, config) {
  const tracked = git(root, ['ls-files', '-z']);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  return Array.from(
    new Set([tracked, untracked].filter(Boolean).flatMap((value) => value.split('\0'))),
  )
    .filter(Boolean)
    .filter((filePath) => pathAccess(config, filePath).allowed)
    .sort();
}

function markNewFilesForDiff(worktreeRoot, paths) {
  for (const filePath of paths) {
    const absolutePath = resolve(worktreeRoot, filePath);
    if (!existsSync(absolutePath)) {
      continue;
    }
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', filePath], {
      cwd: worktreeRoot,
      stdio: 'ignore',
    });
    if (tracked.status !== 0) {
      git(worktreeRoot, ['add', '--intent-to-add', '--', filePath]);
    }
  }
}

export function createAgentTools(context) {
  let toolCalls = 0;

  function assertToolBudget() {
    toolCalls += 1;
    if (toolCalls > context.config.maximumToolCalls) {
      throw new Error('Maximum tool-call budget exceeded.');
    }
  }

  function listFiles(args) {
    const limit = boundedInteger(args.limit, 200, 1, 500);
    const files = repositoryFiles(context.worktreeRoot, context.config)
      .filter((filePath) => !args.glob || globMatches(filePath, args.glob))
      .slice(0, limit);
    return { ok: true, files, truncated: files.length === limit };
  }

  function search(args) {
    if (typeof args.query !== 'string' || !args.query) {
      throw new Error('search.query must be a non-empty string.');
    }
    const limit = boundedInteger(args.limit, 100, 1, 200);
    const commandArgs = [
      '--line-number',
      '--no-heading',
      '--color',
      'never',
      '--fixed-strings',
      '--hidden',
      '--max-count',
      String(limit),
    ];
    if (args.glob) {
      const access = pathAccess(context.config, args.glob);
      if (!access.allowed || args.glob.startsWith('!')) {
        throw new Error('Search glob targets or may re-include a denied path.');
      }
      commandArgs.push('--glob', args.glob);
    }
    for (const pattern of context.config.deniedPatterns) {
      commandArgs.push('--glob', '!' + pattern);
    }
    commandArgs.push('--', args.query, '.');
    const result = spawnSync('rg', commandArgs, {
      cwd: context.worktreeRoot,
      encoding: 'utf8',
      timeout: context.config.searchTimeoutMs,
      maxBuffer: context.config.maximumToolOutputBytes * 4,
    });
    if (result.error?.code === 'ETIMEDOUT') {
      throw new Error('Search timed out after ' + context.config.searchTimeoutMs + ' ms.');
    }
    if (result.error?.code === 'ENOENT') {
      throw new Error('Search requires the rg (ripgrep) executable.');
    }
    if (![0, 1].includes(result.status)) {
      throw new Error(
        'Search failed: ' + (result.stderr || result.error?.message || 'unknown error'),
      );
    }
    const matches = (result.stdout || '').split(/\r?\n/u).filter(Boolean).slice(0, limit);
    return { ok: true, matches, truncated: matches.length === limit };
  }

  function readFile(args) {
    const selected = safeAbsolutePath(context.worktreeRoot, args.path, context.config);
    if (!existsSync(selected.absolutePath) || !lstatSync(selected.absolutePath).isFile()) {
      throw new Error('File does not exist: ' + selected.path);
    }
    const buffer = readFileSync(selected.absolutePath);
    if (buffer.includes(0)) {
      throw new Error('Binary files cannot be read.');
    }
    if (buffer.byteLength > context.config.maximumReadBytes) {
      throw new Error(
        'File exceeds the read limit of ' + context.config.maximumReadBytes + ' bytes.',
      );
    }
    const lines = buffer.toString('utf8').split(/\r?\n/u);
    const startLine = boundedInteger(args.startLine, 1, 1, Math.max(lines.length, 1));
    const endLine = boundedInteger(
      args.endLine,
      Math.min(lines.length, startLine + 249),
      startLine,
      Math.max(lines.length, startLine),
    );
    const content = truncated(
      lines
        .slice(startLine - 1, endLine)
        .map((line, index) => String(startLine + index).padStart(5) + ' | ' + line)
        .join('\n'),
      context.config.maximumToolOutputBytes,
    );
    return { ok: true, path: selected.path, startLine, endLine, content };
  }

  function applyPatch(args) {
    if (typeof args.patch !== 'string') {
      throw new Error('apply_patch.patch must be a string.');
    }
    if (Buffer.byteLength(args.patch, 'utf8') > context.config.maximumPatchBytes) {
      throw new Error('Patch exceeds the configured byte limit.');
    }
    const paths = pathsFromPatch(args.patch);
    const protectedPaths = [];
    for (const filePath of paths) {
      const access = pathAccess(context.config, filePath, { write: true });
      if (access.reason === 'approval_required') {
        protectedPaths.push(access.path);
      } else if (!access.allowed) {
        safeAbsolutePath(context.worktreeRoot, filePath, context.config, { write: true });
      }
      safeAbsolutePath(context.worktreeRoot, filePath, context.config, {
        write: true,
        allowProtected: protectedPaths.includes(access.path),
      });
    }
    const approvalRequest = {
      runId: context.runId,
      capability: 'apply_patch',
      argumentHash: createHash('sha256').update(args.patch).digest('hex'),
      paths: protectedPaths,
    };
    if (
      protectedPaths.length > 0 &&
      !context.allowProtected &&
      !approvalMatches(context.approvalGrant, approvalRequest)
    ) {
      throw new ApprovalRequiredError({
        ...approvalRequest,
        reason: 'The patch modifies protected repository paths.',
      });
    }
    const changedBeforePatch = [
      git(context.worktreeRoot, ['diff', '--name-only', 'HEAD']),
      git(context.worktreeRoot, ['ls-files', '--others', '--exclude-standard']),
    ]
      .join('\n')
      .split(/\r?\n/u)
      .filter(Boolean);
    if (new Set([...changedBeforePatch, ...paths]).size > context.config.maximumChangedFiles) {
      throw new Error('Changed-file limit would be exceeded by this patch.');
    }
    const execution = context.executor.applyPatch(args.patch);
    markNewFilesForDiff(context.worktreeRoot, paths);
    const changedFiles = worktreeStatus(context.worktreeRoot).split(/\r?\n/u).filter(Boolean);
    let whitespaceWarning;
    try {
      git(context.worktreeRoot, ['diff', '--check']);
    } catch (error) {
      whitespaceWarning = String(error.stderr || error.message).trim();
    }
    return {
      ok: execution.ok === true,
      executor: context.executor.type,
      paths,
      status: changedFiles,
      whitespaceWarning,
    };
  }

  function gitDiff() {
    return {
      ok: true,
      status: worktreeStatus(context.worktreeRoot),
      diff: truncated(worktreePatch(context.worktreeRoot), context.config.maximumToolOutputBytes),
    };
  }

  function runChecks(args) {
    return context.executor.runChecks(args.profile);
  }

  function execute(name, args = {}) {
    assertToolBudget();
    const handlers = {
      list_files: listFiles,
      search,
      read_file: readFile,
      apply_patch: applyPatch,
      git_diff: gitDiff,
      run_checks: runChecks,
    };
    const handler = handlers[name];
    if (!handler) {
      throw new Error('Unknown or controller-only tool: ' + name);
    }
    return handler(args);
  }

  return {
    execute,
    runChecks: ({ profile }) => context.executor.runChecks(profile),
    patchHash: () => context.executor.patchHash(),
  };
}
