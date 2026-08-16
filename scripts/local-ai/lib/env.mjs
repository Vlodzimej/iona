import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export const projectRoot = resolve(currentDirectory, '../../..');
export const skillSourceRoot = '~/.agents/skills';
export const containerSkillRoot = '/skills';

export function userSkillRoot() {
  return resolve(homedir(), '.agents/skills');
}

export function normalizeSkillSourcePaths(value) {
  return String(value).replaceAll(userSkillRoot(), skillSourceRoot);
}

export function runtimeSkillRoot(environment = process.env) {
  const configured = environment.LOCAL_AI_SKILL_ROOT?.trim();
  const mounted = environment.LOCAL_AI_SKILLS_MOUNTED === '1';

  if (!mounted) {
    if (configured) {
      throw new Error(
        'LOCAL_AI_SKILL_ROOT is reserved for the internal Docker mount; install skills under ' +
          skillSourceRoot +
          '.',
      );
    }
    return userSkillRoot();
  }

  if (configured !== containerSkillRoot) {
    throw new Error('The internal skill mount must use ' + containerSkillRoot + '.');
  }
  return containerSkillRoot;
}

function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex < 1) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();

  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

export function loadLocalAiEnv() {
  const envPath = resolve(projectRoot, '.env.local-ai');

  if (!existsSync(envPath)) {
    return false;
  }

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const entry = parseEnvLine(line);
    if (entry && process.env[entry.key] === undefined) {
      process.env[entry.key] = entry.value;
    }
  }

  return true;
}

export function numberFromEnv(name, fallback, options = {}) {
  const rawValue = process.env[name];
  const value = rawValue === undefined || rawValue === '' ? fallback : Number(rawValue);
  const minimum = options.minimum ?? Number.NEGATIVE_INFINITY;
  const maximum = options.maximum ?? Number.POSITIVE_INFINITY;

  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(name + ' must be a number between ' + minimum + ' and ' + maximum + '.');
  }

  return value;
}
