import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function runStatePath(projectRoot, runId) {
  if (!/^[a-zA-Z0-9-]+$/u.test(runId)) {
    throw new Error('Invalid run ID.');
  }
  return resolve(projectRoot, '.agent/runs', runId, 'state.json');
}

export function saveRunState(projectRoot, state) {
  const path = runStatePath(projectRoot, state.runId);
  const temporary = path + '.tmp-' + randomBytes(4).toString('hex');
  const value = { ...state, updatedAt: new Date().toISOString() };
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  Object.assign(state, value);
  return state;
}

export function loadRunState(projectRoot, runId) {
  const path = runStatePath(projectRoot, runId);
  if (!existsSync(path)) {
    throw new Error('Agent run does not exist: ' + runId);
  }
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (state.schemaVersion !== 1 || state.runId !== runId) {
    throw new Error('Unsupported or mismatched agent run state.');
  }
  return state;
}

export function publicRunState(state, options = {}) {
  const result = {
    runId: state.runId,
    status: state.status,
    task: state.task,
    model: state.model,
    executor: state.executor,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    approval: state.approval ?? null,
    summary: state.result?.summary ?? null,
    applied: state.result?.applied ?? false,
    error: state.error ?? null,
  };
  if (options.includePatch && state.status === 'completed') {
    result.patch = state.result?.patch ?? '';
    result.validation = state.result?.validation ?? null;
  }
  return result;
}
