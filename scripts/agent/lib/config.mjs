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

  if (config.schemaVersion !== 1) {
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
  return config;
}
