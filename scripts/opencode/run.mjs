#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadLocalAiEnv, projectRoot } from '../local-ai/lib/env.mjs';
import { harnessStateRoot } from '../harness/lib/paths.mjs';
import { registerRepository, repositoryStateRoot } from '../harness/lib/registry.mjs';
import { listHarnessRuns } from '../harness/lib/store.mjs';
import {
  createEnforcedOpenCodeConfig,
  openCodeRunOutcomeError,
  parseHarnessLauncherArguments,
} from './lib/harness-config.mjs';

loadLocalAiEnv();

if (!process.env.LOCAL_AI_BASE_URL?.trim()) {
  console.error(
    'LOCAL_AI_BASE_URL is not configured. Copy .env.local-ai.example to .env.local-ai and set the remote endpoint.',
  );
  process.exit(2);
}

const executable = process.env.OPENCODE_BIN?.trim() || 'opencode';
let parsed;
try {
  parsed = parseHarnessLauncherArguments(process.argv.slice(2), projectRoot);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const stateRoot = harnessStateRoot({
  ...process.env,
  IONIC_HARNESS_STATE_ROOT: parsed.stateRoot || process.env.IONIC_HARNESS_STATE_ROOT,
});
let repository;
try {
  repository = registerRepository(stateRoot, parsed.repositoryPath);
} catch (error) {
  console.error('Cannot register target repository: ' + error.message);
  process.exit(2);
}
const controllerRoot = resolve(stateRoot, 'opencode-workspaces', repository.id);
mkdirSync(controllerRoot, { recursive: true, mode: 0o700 });
const repositoryRoot = repositoryStateRoot(stateRoot, repository.id);
const previousRunIds = listHarnessRuns(repositoryRoot).map((run) => run.runId);
const enforcedConfig = createEnforcedOpenCodeConfig({
  harnessRoot: projectRoot,
  nodeExecutable: process.execPath,
  repositoryId: repository.id,
  profile: parsed.profile,
  stateRoot,
  visual: parsed.visual,
});
const result = spawnSync(executable, parsed.forwarded, {
  cwd: controllerRoot,
  env: {
    ...process.env,
    IONIC_HARNESS_REPOSITORY_ID: repository.id,
    IONIC_HARNESS_PROFILE: parsed.profile,
    IONIC_HARNESS_STATE_ROOT: stateRoot,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(enforcedConfig),
  },
  stdio: 'inherit',
  timeout: parsed.timeoutSeconds ? parsed.timeoutSeconds * 1000 : undefined,
});

if (result.error?.code === 'ENOENT') {
  console.error('OpenCode is not installed or is not available in PATH.');
  process.exit(2);
}

if (result.error) {
  if (result.error.code === 'ETIMEDOUT') {
    console.error('OpenCode session timed out after ' + parsed.timeoutSeconds + ' seconds.');
    process.exit(124);
  }
  console.error('OpenCode failed to start: ' + result.error.message);
  process.exit(1);
}

if (result.signal) {
  console.error('OpenCode exited after signal ' + result.signal + '.');
  process.exit(1);
}

const outcomeError = openCodeRunOutcomeError(
  parsed.forwarded,
  previousRunIds,
  listHarnessRuns(repositoryRoot),
);
if (outcomeError) {
  console.error(outcomeError);
  process.exit(1);
}

process.exit(result.status ?? 1);
