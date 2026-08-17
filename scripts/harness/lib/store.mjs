import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const identifierPattern = /^[a-zA-Z0-9-]+$/u;

function assertIdentifier(value, label) {
  if (!identifierPattern.test(value)) {
    throw new Error('Invalid ' + label + '.');
  }
}

export function secureJsonWrite(path, value) {
  const temporary = path + '.tmp-' + randomBytes(4).toString('hex');
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

export function saveHarnessRun(repositoryRoot, state) {
  assertIdentifier(state.runId, 'harness run ID');
  const runRoot = resolve(repositoryRoot, 'runs', state.runId);
  mkdirSync(runRoot, { recursive: true, mode: 0o700 });
  const value = { ...state, updatedAt: new Date().toISOString() };
  secureJsonWrite(resolve(runRoot, 'state.json'), value);
  Object.assign(state, value);
  return state;
}

export function loadHarnessRun(repositoryRoot, runId) {
  assertIdentifier(runId, 'harness run ID');
  const path = resolve(repositoryRoot, 'runs', runId, 'state.json');
  if (!existsSync(path)) {
    throw new Error('Harness run does not exist: ' + runId + '.');
  }
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (state.schemaVersion !== 1 || state.runId !== runId) {
    throw new Error('Unsupported or mismatched harness run state.');
  }
  return state;
}

export function listHarnessRuns(repositoryRoot) {
  const root = resolve(repositoryRoot, 'runs');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && identifierPattern.test(entry.name))
    .map((entry) => loadHarnessRun(repositoryRoot, entry.name));
}

export function appendHarnessEvent(repositoryRoot, runId, event) {
  assertIdentifier(runId, 'harness run ID');
  const runRoot = resolve(repositoryRoot, 'runs', runId);
  mkdirSync(runRoot, { recursive: true, mode: 0o700 });
  appendFileSync(
    resolve(runRoot, 'events.jsonl'),
    JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n',
    { encoding: 'utf8', mode: 0o600 },
  );
}

function approvalPath(repositoryRoot, approvalId) {
  assertIdentifier(approvalId, 'harness approval ID');
  const root = resolve(repositoryRoot, 'approvals');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  return resolve(root, approvalId + '.json');
}

function currentApproval(approval) {
  if (approval.status === 'pending' && Date.parse(approval.expiresAt) <= Date.now()) {
    return { ...approval, status: 'expired', decidedAt: new Date().toISOString() };
  }
  return approval;
}

export function createHarnessApproval(repositoryRoot, config, details) {
  const createdAt = new Date();
  const approval = {
    schemaVersion: 1,
    id: 'approval-' + randomBytes(10).toString('hex'),
    runId: details.runId,
    capability: details.capability,
    argumentHash: details.argumentHash,
    paths: [...details.paths].sort(),
    reason: details.reason,
    status: 'pending',
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + config.approvals.ttlMs).toISOString(),
  };
  secureJsonWrite(approvalPath(repositoryRoot, approval.id), approval);
  return approval;
}

export function loadHarnessApproval(repositoryRoot, approvalId) {
  const path = approvalPath(repositoryRoot, approvalId);
  if (!existsSync(path)) {
    throw new Error('Harness approval does not exist: ' + approvalId + '.');
  }
  const original = JSON.parse(readFileSync(path, 'utf8'));
  const approval = currentApproval(original);
  if (approval.status !== original.status) {
    secureJsonWrite(path, approval);
  }
  return approval;
}

export function decideHarnessApproval(repositoryRoot, approvalId, decision, actor) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error('Approval decision must be approved or rejected.');
  }
  const approval = loadHarnessApproval(repositoryRoot, approvalId);
  if (approval.status !== 'pending') {
    throw new Error('Approval is already ' + approval.status + '.');
  }
  const decided = {
    ...approval,
    status: decision,
    actor: String(actor || 'local-user').slice(0, 200),
    decidedAt: new Date().toISOString(),
  };
  secureJsonWrite(approvalPath(repositoryRoot, approvalId), decided);
  return decided;
}

export function consumeHarnessApproval(repositoryRoot, approvalId) {
  const approval = loadHarnessApproval(repositoryRoot, approvalId);
  if (approval.status !== 'approved') {
    throw new Error('Only an approved capability can be consumed.');
  }
  const consumed = { ...approval, status: 'consumed', consumedAt: new Date().toISOString() };
  secureJsonWrite(approvalPath(repositoryRoot, approvalId), consumed);
  return consumed;
}
