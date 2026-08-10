import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadAgentConfig } from './lib/config.mjs';
import { macSandboxSupported } from './lib/tools.mjs';
import { projectRoot } from '../local-ai/lib/env.mjs';

let errors = 0;
function status(level, label, detail) {
  console.log('[' + level.toUpperCase() + '] ' + label + ': ' + detail);
  if (level === 'error') {
    errors += 1;
  }
}

try {
  const config = loadAgentConfig(projectRoot);
  status('ok', 'Agent configuration', config.maximumIterations + ' maximum iterations');
} catch (error) {
  status('error', 'Agent configuration', error.message);
}

const git = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: projectRoot,
  encoding: 'utf8',
});
status(
  git.status === 0 ? 'ok' : 'error',
  'Git repository',
  git.stdout?.trim() || git.stderr?.trim(),
);
const ripgrep = spawnSync('rg', ['--version'], { encoding: 'utf8' });
status(
  ripgrep.status === 0 ? 'ok' : 'error',
  'Search dependency',
  ripgrep.status === 0
    ? ripgrep.stdout.trim().split(/\r?\n/u)[0]
    : 'rg (ripgrep) is required for the search tool',
);
for (const promptPath of ['ai/prompts/agent.md', 'ai/prompts/system.md']) {
  status(existsSync(projectRoot + '/' + promptPath) ? 'ok' : 'error', 'Agent prompt', promptPath);
}

const sandboxAvailable = macSandboxSupported();
const hostAllowed = process.env.LOCAL_AGENT_ALLOW_HOST_EXECUTION === '1';
const sourceOnly = process.argv.includes('--source-only');
status(
  sandboxAvailable || hostAllowed ? 'ok' : sourceOnly ? 'warn' : 'error',
  'Command isolation',
  sandboxAvailable
    ? 'macOS sandbox-exec available; validation network access is denied'
    : hostAllowed
      ? 'host execution explicitly enabled'
      : 'validation disabled; use an isolated container or explicit host opt-in',
);

if (errors > 0) {
  process.exitCode = 1;
}
