import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { requiredGlobalSkillPackages, requiredSkillPackages } from '../harness/lib/preflight.mjs';
import { buildContext } from './lib/context.mjs';
import { loadLocalAiEnv, projectRoot, runtimeSkillRoot } from './lib/env.mjs';

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
let errors = 0;
let skillRoot;
try {
  skillRoot = runtimeSkillRoot();
} catch (error) {
  status('error', 'Skill root', error.message);
  errors += 1;
  skillRoot = runtimeSkillRoot({});
}
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);

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

for (const skillPackage of requiredGlobalSkillPackages(projectRoot)) {
  const missing = skillPackage.requiredSkills.filter(
    (skillName) => !existsSync(resolve(skillRoot, skillName, 'SKILL.md')),
  );
  const present = missing.length === 0;
  status(
    present ? 'ok' : 'error',
    'Global skills ' + skillPackage.source,
    present
      ? skillPackage.requiredSkills.length + ' required manifests present'
      : 'missing: ' + missing.join(', ') + '; install with: ' + skillPackage.installCommand,
  );
  if (!present) {
    errors += 1;
  }
}

for (const skill of requiredSkillPackages(projectRoot)) {
  const skillName = skill.name;
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
    maximumSkillBytes: 7200,
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
    maximumSkillBytes: 7200,
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

  const ionicNativeContext = buildContext({
    query: 'Ionic native share haptic feedback',
    maximumSkillBytes: 7200,
  });
  const ionicNativeSources = selectedSources(ionicNativeContext);
  const ionicNativeRouted = ['share.md', 'haptics.md'].every((name) =>
    ionicNativeSources.some(
      (source) =>
        source.includes('/ionic-native-essentials/references/') && source.endsWith('/' + name),
    ),
  );
  status(
    ionicNativeRouted ? 'ok' : 'error',
    'Ionic native routing',
    ionicNativeSources.join(', ') || 'no references selected',
  );
  if (!ionicNativeRouted) {
    errors += 1;
  }

  const deepLinkContext = buildContext({
    query: 'Ionic iOS Universal Link Android App Link routing',
    maximumSkillBytes: 7200,
  });
  const deepLinkSources = selectedSources(deepLinkContext);
  const deepLinkRouted = ['ios-universal-links.md', 'android-app-links.md'].every((name) =>
    deepLinkSources.some(
      (source) => source.includes('/ionic-deep-links/references/') && source.endsWith('/' + name),
    ),
  );
  status(
    deepLinkRouted ? 'ok' : 'error',
    'Ionic deep-link routing',
    deepLinkSources.join(', ') || 'no references selected',
  );
  if (!deepLinkRouted) {
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
