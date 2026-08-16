#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';

const workspace = '/workspace';
const dependencyPath = resolve(workspace, 'node_modules');
const imageDependencies = '/opt/agent/node_modules';

function config() {
  return JSON.parse(readFileSync('/opt/agent/config.json', 'utf8'));
}

function limitedInput(maximumBytes) {
  const input = readFileSync(0);
  if (input.byteLength > maximumBytes) {
    throw new Error('Executor input exceeds the configured patch limit.');
  }
  return input.toString('utf8');
}

function truncate(value, maximumBytes) {
  const buffer = Buffer.from(value ?? '', 'utf8');
  return buffer.byteLength <= maximumBytes
    ? (value ?? '')
    : buffer.subarray(0, maximumBytes).toString('utf8') + '\n<output truncated>';
}

function withDependencies(callback) {
  let created = false;
  if (existsSync(dependencyPath) && lstatSync(dependencyPath).isSymbolicLink()) {
    if (readlinkSync(dependencyPath) === imageDependencies) {
      rmSync(dependencyPath);
    } else {
      throw new Error('The container workspace contains an unexpected dependency symlink.');
    }
  }
  if (!existsSync(dependencyPath)) {
    symlinkSync(imageDependencies, dependencyPath, 'dir');
    created = true;
  }
  try {
    return callback();
  } finally {
    if (created) {
      rmSync(dependencyPath);
    }
  }
}

function applyPatch(agentConfig) {
  const patch = limitedInput(agentConfig.maximumPatchBytes);
  execFileSync(
    'git',
    ['apply', '--no-index', '--directory=workspace', '--check', '--whitespace=error-all', '-'],
    {
      cwd: '/',
      input: patch,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  execFileSync(
    'git',
    ['apply', '--no-index', '--directory=workspace', '--whitespace=nowarn', '-'],
    {
      cwd: '/',
      input: patch,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  return { ok: true };
}

function runChecks(agentConfig, profile) {
  const commands = agentConfig.checks?.[profile];
  if (!Array.isArray(commands)) {
    throw new Error('Unknown validation profile: ' + profile + '.');
  }
  mkdirSync(resolve(workspace, '.agent-tmp'), { recursive: true });
  const environment = {
    PATH: imageDependencies + '/.bin:/usr/local/bin:/usr/bin:/bin',
    HOME: '/tmp',
    TMPDIR: resolve(workspace, '.agent-tmp'),
    TMP: resolve(workspace, '.agent-tmp'),
    TEMP: resolve(workspace, '.agent-tmp'),
    npm_config_cache: resolve(workspace, '.agent-tmp/npm-cache'),
    npm_config_update_notifier: 'false',
    NG_CLI_ANALYTICS: 'false',
    LOCAL_AI_SKILLS_MOUNTED: '1',
    LOCAL_AI_SKILL_ROOT: '/skills',
    LOCAL_AGENT_EXECUTOR: 'local',
    LOCAL_AGENT_ALLOW_HOST_EXECUTION: '1',
    LOCAL_AGENT_SKIP_INTEGRATION: '1',
  };
  const results = [];
  return withDependencies(() => {
    for (const command of commands) {
      const [executable, ...args] = command;
      const result = spawnSync(executable, args, {
        cwd: workspace,
        encoding: 'utf8',
        env: environment,
        timeout: agentConfig.checkTimeoutMs,
        maxBuffer: agentConfig.maximumToolOutputBytes * 8,
      });
      const entry = {
        ok: result.status === 0 && !result.error,
        command,
        exitCode: result.status,
        signal: result.signal,
        output: truncate(
          [result.stdout, result.stderr].filter(Boolean).join('\n'),
          agentConfig.maximumToolOutputBytes,
        ),
        error: result.error?.message,
      };
      results.push(entry);
      if (!entry.ok) {
        break;
      }
    }
    return { ok: results.every((entry) => entry.ok), profile, results };
  });
}

try {
  const agentConfig = config();
  const action = process.argv[2];
  const result =
    action === 'apply-patch'
      ? applyPatch(agentConfig)
      : action === 'run-checks'
        ? runChecks(agentConfig, process.argv[3])
        : (() => {
            throw new Error('Unknown executor action.');
          })();
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
