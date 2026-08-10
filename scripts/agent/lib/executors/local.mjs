import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { worktreePatch, worktreeStatus } from '../worktree.mjs';

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
        'Local executor has no supported process sandbox. Use Docker or explicitly allow host execution.',
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

export function createLocalExecutor(context) {
  return {
    type: 'local',
    applyPatch(patch) {
      git(context.worktreeRoot, ['apply', '--check', '--whitespace=error-all', '-'], {
        input: patch,
      });
      git(context.worktreeRoot, ['apply', '--whitespace=nowarn', '-'], { input: patch });
      return { ok: true };
    },
    runChecks(profile) {
      const commands = context.config.checks[profile];
      if (!commands) {
        throw new Error('Unknown validation profile: ' + profile + '.');
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
        executor: 'local',
        profile,
        patchHash: createHash('sha256').update(worktreePatch(context.worktreeRoot)).digest('hex'),
        results,
      };
    },
    patchHash() {
      return createHash('sha256').update(worktreePatch(context.worktreeRoot)).digest('hex');
    },
    status() {
      return worktreeStatus(context.worktreeRoot);
    },
  };
}
