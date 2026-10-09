import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const extension = dirname(fileURLToPath(import.meta.url));
const root = resolve(extension, '../..');
const target = resolve(extension, 'dist/runtime');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
// Explicit runtime allowlist. Never package env files, skill packages or generated reports.
for (const file of [
  'ai/agent.json',
  'ai/harness.json',
  'ai/profiles/angular-ionic-capacitor.json',
  'ai/prompts/agent.md',
  'docker/agent-runner.mjs',
  'scripts/agent/lib/approval.mjs',
  'scripts/agent/lib/config.mjs',
  'scripts/agent/lib/executor.mjs',
  'scripts/agent/lib/policy.mjs',
  'scripts/agent/lib/tools.mjs',
  'scripts/agent/lib/worktree.mjs',
  'scripts/agent/lib/executors/docker.mjs',
  'scripts/agent/lib/executors/local.mjs',
  'scripts/harness/lib/dependencies.mjs',
  'scripts/harness/lib/paths.mjs',
  'scripts/harness/lib/profile.mjs',
  'scripts/harness/lib/registry.mjs',
  'scripts/harness/lib/session.mjs',
  'scripts/harness/lib/store.mjs',
  'scripts/local-ai/lib/env.mjs',
  'scripts/local-ai/lib/context.mjs',
  'scripts/local-ai/lib/client.mjs',
  'scripts/agent/lib/protocol.mjs',
  'scripts/vscode/agent-base.Dockerfile',
  'scripts/vscode/provider.mjs',
  'scripts/vscode/service.mjs',
  'scripts/vscode/bridge.mjs',
])
  cpSync(resolve(root, file), resolve(target, file), { recursive: true });

cpSync(
  resolve(root, 'scripts/vscode/project-agent-runner.Dockerfile'),
  resolve(target, 'docker/project-agent-runner.Dockerfile'),
);

// Bundle the browser parser; raw model HTML is never inserted into the webview.
cpSync(
  resolve(extension, 'node_modules/markdown-it/dist/browser/markdown-it.umd.min.js'),
  resolve(extension, 'dist/markdown-it.min.js'),
);
