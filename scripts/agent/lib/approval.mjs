import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function approvalRoot(projectRoot) {
  const root = resolve(projectRoot, '.agent/approvals');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  return root;
}

function approvalPath(projectRoot, approvalId) {
  if (!/^[a-zA-Z0-9-]+$/u.test(approvalId)) {
    throw new Error('Invalid approval ID.');
  }
  return resolve(approvalRoot(projectRoot), approvalId + '.json');
}

function writeSecureJson(path, value) {
  const temporary = path + '.tmp-' + randomBytes(4).toString('hex');
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function currentApproval(approval) {
  if (approval.status === 'pending' && Date.parse(approval.expiresAt) <= Date.now()) {
    return { ...approval, status: 'expired', decidedAt: new Date().toISOString() };
  }
  return approval;
}

export class ApprovalRequiredError extends Error {
  constructor(details) {
    super('Protected capability requires approval.');
    this.name = 'ApprovalRequiredError';
    this.details = details;
  }
}

export function createApproval(projectRoot, config, details) {
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
  writeSecureJson(approvalPath(projectRoot, approval.id), approval);
  return approval;
}

export function loadApproval(projectRoot, approvalId) {
  const path = approvalPath(projectRoot, approvalId);
  if (!existsSync(path)) {
    throw new Error('Approval does not exist: ' + approvalId);
  }
  const original = JSON.parse(readFileSync(path, 'utf8'));
  const approval = currentApproval(original);
  if (approval.status !== original.status) {
    writeSecureJson(path, approval);
  }
  return approval;
}

export function decideApproval(projectRoot, approvalId, decision, actor = 'local-user') {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error('Approval decision must be approved or rejected.');
  }
  const approval = loadApproval(projectRoot, approvalId);
  if (approval.status !== 'pending') {
    throw new Error('Approval is already ' + approval.status + '.');
  }
  const decided = {
    ...approval,
    status: decision,
    actor: String(actor).slice(0, 200),
    decidedAt: new Date().toISOString(),
  };
  writeSecureJson(approvalPath(projectRoot, approvalId), decided);
  return decided;
}

export function approvalMatches(grant, request) {
  if (
    !grant ||
    grant.status !== 'approved' ||
    grant.capability !== request.capability ||
    (request.runId && grant.runId !== request.runId)
  ) {
    return false;
  }
  const left = Buffer.from(grant.argumentHash, 'utf8');
  const right = Buffer.from(request.argumentHash, 'utf8');
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return false;
  }
  return JSON.stringify([...grant.paths].sort()) === JSON.stringify([...request.paths].sort());
}
