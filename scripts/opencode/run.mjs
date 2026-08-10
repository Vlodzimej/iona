#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { loadLocalAiEnv, projectRoot } from '../local-ai/lib/env.mjs';

loadLocalAiEnv();

if (!process.env.LOCAL_AI_BASE_URL?.trim()) {
  console.error(
    'LOCAL_AI_BASE_URL is not configured. Copy .env.local-ai.example to .env.local-ai and set the remote endpoint.',
  );
  process.exit(2);
}

const executable = process.env.OPENCODE_BIN?.trim() || 'opencode';
const result = spawnSync(executable, process.argv.slice(2), {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
});

if (result.error?.code === 'ENOENT') {
  console.error('OpenCode is not installed or is not available in PATH.');
  process.exit(2);
}

if (result.error) {
  console.error('OpenCode failed to start: ' + result.error.message);
  process.exit(1);
}

if (result.signal) {
  console.error('OpenCode exited after signal ' + result.signal + '.');
  process.exit(1);
}

process.exit(result.status ?? 1);
