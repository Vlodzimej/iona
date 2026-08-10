import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { worktreePatch, worktreeStatus } from '../worktree.mjs';

function mount(source, destination, readOnly = false) {
  return `type=bind,src=${source},dst=${destination}${readOnly ? ',readonly' : ''}`;
}

export function dockerRunArguments(context, action, actionArguments = []) {
  const docker = context.config.executor.docker;
  const temporary = resolve(context.worktreeRoot, '.agent-tmp');
  mkdirSync(temporary, { recursive: true });
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const passwdPath = resolve(temporary, 'container-passwd');
  const groupPath = resolve(temporary, 'container-group');
  writeFileSync(passwdPath, `agent:x:${uid}:${gid}:Agent Runner:${docker.workspace}:/bin/false\n`, {
    mode: 0o600,
  });
  writeFileSync(groupPath, `agent:x:${gid}:\n`, { mode: 0o600 });
  chmodSync(passwdPath, 0o600);
  chmodSync(groupPath, 0o600);
  const args = [
    'run',
    '--rm',
    '--init',
    '--interactive',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    String(docker.pidsLimit),
    '--memory',
    docker.memory,
    '--cpus',
    String(docker.cpus),
    '--user',
    `${uid}:${gid}`,
    '--workdir',
    docker.workspace,
    '--mount',
    mount(context.worktreeRoot, docker.workspace),
    '--mount',
    mount(temporary, docker.workspace + '/.agent-tmp'),
    '--mount',
    mount(passwdPath, '/etc/passwd', true),
    '--mount',
    mount(groupPath, '/etc/group', true),
    '--tmpfs',
    `/tmp:rw,noexec,nosuid,size=${docker.temporaryStorage}`,
    '--env',
    'HOME=/tmp',
    '--env',
    'TMPDIR=' + docker.workspace + '/.agent-tmp',
    '--env',
    'npm_config_cache=' + docker.workspace + '/.agent-tmp/npm-cache',
    '--env',
    'npm_config_update_notifier=false',
    '--env',
    'NG_CLI_ANALYTICS=false',
  ];
  const skills = resolve(homedir(), '.agents/skills');
  if (existsSync(skills)) {
    args.push('--mount', mount(skills, '/skills', true), '--env', 'LOCAL_AI_SKILL_ROOT=/skills');
  }
  args.push(docker.image, action, ...actionArguments);
  return args;
}

function runContainer(context, action, actionArguments = [], input) {
  const result = spawnSync('docker', dockerRunArguments(context, action, actionArguments), {
    encoding: 'utf8',
    input,
    timeout: context.config.checkTimeoutMs,
    maxBuffer: context.config.maximumToolOutputBytes * 8,
  });
  if (result.error?.code === 'ENOENT') {
    throw new Error('Docker CLI is not installed.');
  }
  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error('Docker executor timed out after ' + context.config.checkTimeoutMs + ' ms.');
  }
  if (result.status !== 0) {
    throw new Error(
      'Docker executor failed: ' +
        (result.stderr || result.stdout || result.error?.message || 'unknown error').trim(),
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('Docker executor returned invalid JSON.');
  }
}

export function createDockerExecutor(context) {
  return {
    type: 'docker',
    applyPatch(patch) {
      return runContainer(context, 'apply-patch', [], patch);
    },
    runChecks(profile) {
      const result = runContainer(context, 'run-checks', [profile]);
      return {
        ...result,
        executor: 'docker',
        patchHash: createHash('sha256').update(worktreePatch(context.worktreeRoot)).digest('hex'),
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
