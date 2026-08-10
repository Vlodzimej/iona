import { spawnSync } from 'node:child_process';
import { createDockerExecutor } from './executors/docker.mjs';
import { createLocalExecutor } from './executors/local.mjs';

export function selectedExecutor(config, override) {
  const selected = override || process.env.LOCAL_AGENT_EXECUTOR?.trim() || config.executor.default;
  if (!['local', 'docker'].includes(selected)) {
    throw new Error('Agent executor must be local or docker.');
  }
  return selected;
}

export function createExecutor(context) {
  const type = selectedExecutor(context.config, context.type);
  return type === 'docker'
    ? createDockerExecutor({ ...context, type })
    : createLocalExecutor({ ...context, type });
}

export function dockerStatus(config) {
  const version = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (version.error?.code === 'ENOENT') {
    return { ok: false, error: 'Docker CLI is not installed.' };
  }
  if (version.status !== 0) {
    return {
      ok: false,
      error: (version.stderr || version.stdout || 'Docker daemon is unavailable.').trim(),
    };
  }
  const image = spawnSync('docker', ['image', 'inspect', config.executor.docker.image], {
    encoding: 'utf8',
    timeout: 10000,
  });
  return {
    ok: image.status === 0,
    serverVersion: version.stdout.trim(),
    image: config.executor.docker.image,
    error: image.status === 0 ? null : 'Runner image is missing. Run npm run agent:docker:build.',
  };
}
