import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAgentConfig, validateAgentConfig } from '../../agent/lib/config.mjs';

const profileName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function loadHarnessProfile(harnessRoot, id) {
  if (!profileName.test(id)) {
    throw new Error('Invalid harness profile ID.');
  }
  const base = loadAgentConfig(harnessRoot);
  const path = resolve(harnessRoot, 'ai/profiles', id + '.json');
  const profile = JSON.parse(readFileSync(path, 'utf8'));
  if (profile.schemaVersion !== 1 || profile.id !== id) {
    throw new Error('Unsupported or mismatched harness profile: ' + id + '.');
  }
  const config = {
    ...base,
    checks: profile.checks,
    requiredFinishCheck: profile.requiredFinishCheck,
  };
  return {
    id,
    description: String(profile.description || ''),
    config: validateAgentConfig(config, 'harness profile ' + id),
  };
}
