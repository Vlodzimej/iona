import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { globMatches, pathAccess, pathsFromPatch, safeAbsolutePath } from './policy.mjs';
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

function patchHash(root) {
  return createHash('sha256').update(worktreePatch(root)).digest('hex');
}

function sbplString(value) {
  return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
}

export function sandboxProfile(worktreeRoot) {
  const userHome = homedir();
  const dependencyLink = resolve(worktreeRoot, 'node_modules');
  const nodeRuntimeRoot = resolve(dirname(process.execPath), '..');
  const allowedReadRoots = [
    '/System',
    '/usr',
    '/bin',
    '/sbin',
    '/Library',
    '/opt',
    '/dev',
    worktreeRoot,
    resolve(userHome, '.agents/skills'),
    nodeRuntimeRoot,
    ...(existsSync(dependencyLink) ? [realpathSync(dependencyLink)] : []),
  ];
  return [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow file-read*',
    ...allowedReadRoots.map((root) => '  (subpath ' + sbplString(root) + ')'),
    ')',
    '(allow file-write* (subpath ' + sbplString(worktreeRoot) + '))',
  ].join('\n');
}

let sandboxSupport;
export function macSandboxSupported() {
  if (sandboxSupport !== undefined) {
    return sandboxSupport;
  }
  if (platform() !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) {
    sandboxSupport = false;
    return sandboxSupport;
  }
  const probe = spawnSync(
    '/usr/bin/sandbox-exec',
    ['-p', sandboxProfile(resolve(tmpdir(), 'ionic-llm-agent-sandbox-probe')), '/usr/bin/true'],
    { encoding: 'utf8' },
  );
  sandboxSupport = probe.status === 0;
  return sandboxSupport;
}

function runAllowlistedCommand(context, command) {
  const [executable, ...args] = command;
  const commandTemp = resolve(context.worktreeRoot, '.agent-tmp');
  mkdirSync(commandTemp, { recursive: true });
  const environment = {
    ...process.env,
    TMPDIR: commandTemp,
    TMP: commandTemp,
    TEMP: commandTemp,
    npm_config_cache: resolve(commandTemp, 'npm-cache'),
    npm_config_update_notifier: 'false',
    NG_CLI_ANALYTICS: 'false',
  };
  let result;

  if (macSandboxSupported()) {
    result = spawnSync(
      '/usr/bin/sandbox-exec',
      ['-p', sandboxProfile(context.worktreeRoot), executable, ...args],
      {
        cwd: context.worktreeRoot,
        encoding: 'utf8',
        env: environment,
        timeout: context.config.checkTimeoutMs,
        maxBuffer: context.config.maximumToolOutputBytes * 8,
      },
    );
  } else if (context.allowHostExecution) {
    result = spawnSync(executable, args, {
      cwd: context.worktreeRoot,
      encoding: 'utf8',
      env: environment,
      timeout: context.config.checkTimeoutMs,
      maxBuffer: context.config.maximumToolOutputBytes * 8,
    });
  } else {
    return {
      ok: false,
      command,
      error:
        'No supported process sandbox is available. Set LOCAL_AGENT_ALLOW_HOST_EXECUTION=1 only in an isolated environment.',
    };
  }

  const output = truncated(
    [result.stdout, result.stderr].filter(Boolean).join('\n'),
    context.config.maximumToolOutputBytes,
  );
  return {
    ok: result.status === 0 && !result.error,
    command,
    exitCode: result.status,
    signal: result.signal,
    output,
    error: result.error?.message,
  };
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
    for (const filePath of paths) {
      safeAbsolutePath(context.worktreeRoot, filePath, context.config, {
        write: true,
        allowProtected: context.allowProtected,
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
    git(context.worktreeRoot, ['apply', '--check', '--whitespace=error-all', '-'], {
      input: args.patch,
    });
    git(context.worktreeRoot, ['apply', '--whitespace=nowarn', '-'], { input: args.patch });
    for (const filePath of paths) {
      const absolutePath = resolve(context.worktreeRoot, filePath);
      if (existsSync(absolutePath)) {
        const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', filePath], {
          cwd: context.worktreeRoot,
          stdio: 'ignore',
        });
        if (tracked.status !== 0) {
          git(context.worktreeRoot, ['add', '--intent-to-add', '--', filePath]);
        }
      }
    }
    const changedFiles = worktreeStatus(context.worktreeRoot).split(/\r?\n/u).filter(Boolean);
    let whitespaceWarning;
    try {
      git(context.worktreeRoot, ['diff', '--check']);
    } catch (error) {
      whitespaceWarning = String(error.stderr || error.message).trim();
    }
    return { ok: true, paths, status: changedFiles, whitespaceWarning };
  }

  function gitDiff() {
    return {
      ok: true,
      status: worktreeStatus(context.worktreeRoot),
      diff: truncated(worktreePatch(context.worktreeRoot), context.config.maximumToolOutputBytes),
    };
  }

  function runChecks(args) {
    const commands = context.config.checks[args.profile];
    if (!commands) {
      throw new Error('Unknown validation profile: ' + args.profile);
    }
    const results = [];
    for (const command of commands) {
      const result = runAllowlistedCommand(context, command);
      results.push(result);
      if (!result.ok) {
        break;
      }
    }
    return {
      ok: results.every((result) => result.ok),
      profile: args.profile,
      patchHash: patchHash(context.worktreeRoot),
      results,
    };
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

  return { execute, runChecks, patchHash: () => patchHash(context.worktreeRoot) };
}
