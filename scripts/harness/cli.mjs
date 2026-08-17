#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { harnessRoot } from './lib/paths.mjs';

const [command, ...args] = process.argv.slice(2);
const controlCommands = new Set([
  'register',
  'prepare',
  'status',
  'approve',
  'reject',
  'apply',
  'discard',
]);

function usage() {
  console.log(`Usage: ionic-llm-harness <command> [arguments]

Commands:
  doctor --repo PATH             Check the shared harness and target project
  prepare PATH                   Build/cache the target dependency runner
  opencode --repo PATH [ARGS]    Start OpenCode through the enforced harness
  visual-target PATH URL         Register an exact HTTP loopback target
  visual-android PATH OPTIONS    Register an authorized Android WebView target
  visual-ios-sim PATH OPTIONS    Register a booted iOS Simulator screenshot target
  visual-appium PATH OPTIONS     Register an existing loopback Appium WebView session
  visual-baseline PATH PNG       Register an immutable PNG design baseline
  visual-list PATH               List registered visual target and baseline IDs
  visual-status PATH RUN         Show a visual run and its external artifact directory
  register PATH                  Register a target repository
  status REPOSITORY RUN          Show run status
  approve REPOSITORY APPROVAL    Approve an exact protected patch
  reject REPOSITORY APPROVAL     Reject an exact protected patch
  apply REPOSITORY RUN           Apply a sealed patch to the primary checkout
  discard REPOSITORY RUN         Remove an abandoned isolated worktree

Harness files, state and worktrees remain outside the target repository.`);
}

if (!command || ['help', '--help', '-h'].includes(command)) {
  usage();
  process.exit(0);
}

let script;
let forwarded = args;
if (command === 'doctor') {
  script = 'scripts/harness/doctor.mjs';
} else if (command === 'opencode') {
  script = 'scripts/opencode/run.mjs';
} else if (command === 'visual-target') {
  script = 'scripts/harness/visual-control.mjs';
  forwarded = ['target', ...args];
} else if (command === 'visual-android') {
  script = 'scripts/harness/visual-control.mjs';
  forwarded = ['android-webview', ...args];
} else if (command === 'visual-ios-sim') {
  script = 'scripts/harness/visual-control.mjs';
  forwarded = ['ios-simulator', ...args];
} else if (command === 'visual-appium') {
  script = 'scripts/harness/visual-control.mjs';
  forwarded = ['appium-webview', ...args];
} else if (command === 'visual-baseline') {
  script = 'scripts/harness/visual-control.mjs';
  forwarded = ['baseline', ...args];
} else if (command === 'visual-list') {
  script = 'scripts/harness/visual-control.mjs';
  forwarded = ['list', ...args];
} else if (command === 'visual-status') {
  script = 'scripts/harness/visual-control.mjs';
  forwarded = ['status', ...args];
} else if (controlCommands.has(command)) {
  script = 'scripts/harness/control.mjs';
  forwarded = [command, ...args];
} else {
  console.error('Unknown harness command: ' + command);
  usage();
  process.exit(2);
}

const result = spawnSync(process.execPath, [resolve(harnessRoot, script), ...forwarded], {
  cwd: harnessRoot,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error('Harness command failed to start: ' + result.error.message);
  process.exit(1);
}

if (result.signal) {
  console.error('Harness command exited after signal ' + result.signal + '.');
  process.exit(1);
}

process.exit(result.status ?? 1);
