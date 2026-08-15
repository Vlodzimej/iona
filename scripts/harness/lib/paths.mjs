import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { projectRoot } from '../../local-ai/lib/env.mjs';

export const harnessRoot = projectRoot;

export function harnessStateRoot(environment = process.env) {
  const configured = environment.IONIC_HARNESS_STATE_ROOT?.trim();
  if (configured) {
    return resolve(configured);
  }
  const dataRoot = environment.XDG_DATA_HOME?.trim() || resolve(homedir(), '.local/share');
  return resolve(dataRoot, 'ionic-llm-harness');
}

export function requiredEnvironment(name, environment = process.env) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(name + ' is required. Start OpenCode through the harness launcher.');
  }
  return value;
}
