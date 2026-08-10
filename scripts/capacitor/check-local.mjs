#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const executable = resolve(projectRoot, 'node_modules/.bin/cap');
const result = spawnSync(executable, ['config'], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: { ...process.env, NO_COLOR: '1' },
  timeout: 30_000,
  maxBuffer: 2 * 1024 * 1024,
});

if (result.error || result.status !== 0) {
  console.error((result.stderr || result.stdout || result.error?.message || '').trim());
  process.exitCode = 1;
} else {
  console.log('Capacitor configuration loaded successfully without network access.');
}
