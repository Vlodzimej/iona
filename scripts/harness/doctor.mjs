#!/usr/bin/env node
import { resolve } from 'node:path';
import { loadLocalAiEnv, runtimeSkillRoot } from '../local-ai/lib/env.mjs';
import { harnessRoot, harnessStateRoot } from './lib/paths.mjs';
import { inspectHarnessPreflight } from './lib/preflight.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(name + ' requires a value.');
  }
  return value;
}

function print(check) {
  const prefix = check.level === 'ok' ? '[OK]' : check.level === 'warn' ? '[WARN]' : '[ERROR]';
  console.log(prefix + ' ' + check.label + ': ' + check.detail);
  if (check.remediation) console.log('       ' + check.remediation);
}

let repositoryPath;
try {
  repositoryPath = resolve(option('--repo') || harnessRoot);
} catch (error) {
  console.error('Harness doctor failed: ' + error.message);
  process.exit(2);
}

loadLocalAiEnv();
let skillRoot;
try {
  skillRoot = runtimeSkillRoot();
} catch (error) {
  console.error('Harness doctor failed: ' + error.message);
  process.exit(2);
}

const checks = inspectHarnessPreflight({
  harnessRoot,
  repositoryPath,
  skillRoot,
  stateRoot: harnessStateRoot(),
  sourceOnly: process.argv.includes('--source-only'),
});
checks.forEach(print);

const errors = checks.filter((check) => check.level === 'error').length;
const warnings = checks.filter((check) => check.level === 'warn').length;
console.log(
  '\nPreflight: ' +
    (errors === 0 ? 'ready' : 'not ready') +
    ' (' +
    errors +
    ' errors, ' +
    warnings +
    ' warnings). Target files were not changed.',
);
if (errors > 0) process.exitCode = 1;
