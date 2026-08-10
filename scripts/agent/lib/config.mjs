import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadAgentConfig(projectRoot) {
  const path = resolve(projectRoot, 'ai/agent.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  const positiveIntegers = [
    'maximumIterations',
    'maximumToolCalls',
    'maximumToolOutputBytes',
    'maximumReadBytes',
    'maximumPatchBytes',
    'maximumChangedFiles',
    'checkTimeoutMs',
    'searchTimeoutMs',
  ];

  if (config.schemaVersion !== 2) {
    throw new Error('Unsupported ai/agent.json schemaVersion.');
  }
  for (const key of positiveIntegers) {
    if (!Number.isInteger(config[key]) || config[key] < 1) {
      throw new Error('ai/agent.json ' + key + ' must be a positive integer.');
    }
  }
  for (const key of ['allowedWritePatterns', 'protectedWritePatterns', 'deniedPatterns']) {
    if (!Array.isArray(config[key]) || config[key].some((value) => typeof value !== 'string')) {
      throw new Error('ai/agent.json ' + key + ' must be an array of strings.');
    }
  }
  if (!config.checks?.[config.requiredFinishCheck]) {
    throw new Error('ai/agent.json requiredFinishCheck must name a configured check profile.');
  }
  for (const [profile, commands] of Object.entries(config.checks)) {
    if (
      !Array.isArray(commands) ||
      commands.some(
        (command) =>
          !Array.isArray(command) ||
          command.length === 0 ||
          command.some((part) => typeof part !== 'string' || part.length === 0),
      )
    ) {
      throw new Error('Invalid command list for check profile ' + profile + '.');
    }
  }
  if (!['local', 'docker'].includes(config.executor?.default)) {
    throw new Error('ai/agent.json executor.default must be local or docker.');
  }
  const docker = config.executor?.docker;
  if (
    !docker ||
    typeof docker.image !== 'string' ||
    !docker.image ||
    typeof docker.workspace !== 'string' ||
    !docker.workspace.startsWith('/') ||
    docker.network !== 'none' ||
    typeof docker.memory !== 'string' ||
    typeof docker.temporaryStorage !== 'string' ||
    !Number.isFinite(docker.cpus) ||
    docker.cpus <= 0 ||
    !Number.isInteger(docker.pidsLimit) ||
    docker.pidsLimit < 1
  ) {
    throw new Error('ai/agent.json executor.docker is invalid or enables networking.');
  }
  if (!Number.isInteger(config.approvals?.ttlMs) || config.approvals.ttlMs < 1000) {
    throw new Error('ai/agent.json approvals.ttlMs must be at least 1000.');
  }
  if (
    typeof config.api?.hostname !== 'string' ||
    !Number.isInteger(config.api?.port) ||
    config.api.port < 1 ||
    config.api.port > 65535 ||
    !Number.isInteger(config.api.maximumBodyBytes) ||
    config.api.maximumBodyBytes < 1 ||
    !Number.isInteger(config.api.maximumConcurrentRuns) ||
    config.api.maximumConcurrentRuns < 1 ||
    typeof config.api.tokenEnvironmentVariable !== 'string' ||
    !config.api.tokenEnvironmentVariable
  ) {
    throw new Error('ai/agent.json api configuration is invalid.');
  }
  return config;
}
