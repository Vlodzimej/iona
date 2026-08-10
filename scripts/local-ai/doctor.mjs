import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildContext } from './lib/context.mjs';
import { loadLocalAiEnv, projectRoot } from './lib/env.mjs';

function commandVersion(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return (result.stdout || result.stderr).trim().split(/\r?\n/u)[0];
}

function status(level, label, detail) {
  const prefix = level === 'ok' ? '[OK]' : level === 'warn' ? '[WARN]' : '[ERROR]';
  console.log(prefix + ' ' + label + ': ' + detail);
}

function selectedSources(context) {
  return context.skills.flatMap((skill) => skill.references.map((reference) => reference.source));
}

const envFileLoaded = loadLocalAiEnv();
const skillRoot = process.env.LOCAL_AI_SKILL_ROOT?.trim()
  ? resolve(process.env.LOCAL_AI_SKILL_ROOT.trim().replace(/^~(?=\/|$)/u, homedir()))
  : resolve(homedir(), '.agents/skills');
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
let errors = 0;

if (nodeMajor > 24 || (nodeMajor === 24 && nodeMinor >= 15)) {
  status('ok', 'Node.js', process.versions.node);
} else {
  status('error', 'Node.js', process.versions.node + '; Angular 22 requires Node >=24.15');
  errors += 1;
}

for (const [label, command, args, required] of [
  ['npm', 'npm', ['--version'], true],
  ['Git', 'git', ['--version'], true],
  ['ripgrep', 'rg', ['--version'], false],
  ['SSH (optional tunnel)', 'ssh', ['-V'], false],
]) {
  const version = commandVersion(command, args);
  if (version) {
    status('ok', label, version);
  } else if (required) {
    status('error', label, 'not available');
    errors += 1;
  } else {
    status('warn', label, 'not available');
  }
}

for (const requiredPath of [
  'AGENTS.md',
  'ai/harness.json',
  'ai/prompts/system.md',
  'ai/remote-model.md',
  'ai/evals/task.schema.json',
]) {
  const present = existsSync(resolve(projectRoot, requiredPath));
  status(present ? 'ok' : 'error', requiredPath, present ? 'present' : 'missing');
  if (!present) {
    errors += 1;
  }
}

for (const skillName of ['angular-developer', 'capacitor-plugins']) {
  const manifest = resolve(skillRoot, skillName, 'SKILL.md');
  const present = existsSync(manifest);
  status(present ? 'ok' : 'error', 'Skill ' + skillName, present ? manifest : 'missing');
  if (!present) {
    errors += 1;
  }
}

try {
  const angularContext = buildContext({
    query: 'Angular signals HttpClient standalone component',
    maximumSkillBytes: 6000,
  });
  const angularSources = selectedSources(angularContext);
  const angularRouted = ['http-client.md', 'signals-overview.md'].every((name) =>
    angularSources.some((source) => source.endsWith('/' + name)),
  );
  status(
    angularRouted ? 'ok' : 'error',
    'Angular routing',
    angularSources.join(', ') || 'no references selected',
  );
  if (!angularRouted) {
    errors += 1;
  }

  const capacitorContext = buildContext({
    query: 'Capacitor камера и биометрическая проверка',
    maximumSkillBytes: 6000,
  });
  const capacitorSources = selectedSources(capacitorContext);
  const capacitorRouted = ['capacitor-camera.md', 'capgo-plugin-catalog.md'].every((name) =>
    capacitorSources.some((source) => source.endsWith('/' + name)),
  );
  status(
    capacitorRouted ? 'ok' : 'error',
    'Capacitor routing',
    capacitorSources.join(', ') || 'no references selected',
  );
  if (!capacitorRouted) {
    errors += 1;
  }
} catch (error) {
  status('error', 'Skill retrieval', error.message);
  errors += 1;
}

status(
  envFileLoaded ? 'ok' : 'warn',
  'Model connection',
  envFileLoaded
    ? '.env.local-ai loaded; use npm run ai:smoke when the endpoint is available'
    : 'copy .env.local-ai.example to .env.local-ai before connecting',
);

if (errors > 0) {
  process.exitCode = 1;
}
