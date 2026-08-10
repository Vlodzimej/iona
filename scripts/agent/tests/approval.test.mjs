import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { approvalMatches, createApproval, decideApproval, loadApproval } from '../lib/approval.mjs';

test('approval is persisted securely and authorizes only the exact capability arguments', (context) => {
  const root = mkdtempSync(resolve(tmpdir(), 'ionic-agent-approval-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const request = {
    runId: 'run-1',
    capability: 'apply_patch',
    argumentHash: 'abc123',
    paths: ['package.json'],
  };
  const approval = createApproval(
    root,
    { approvals: { ttlMs: 60_000 } },
    {
      ...request,
      runId: 'run-1',
      reason: 'Protected path',
    },
  );
  assert.equal(approval.status, 'pending');
  assert.equal(
    statSync(resolve(root, '.agent/approvals', approval.id + '.json')).mode & 0o777,
    0o600,
  );

  const grant = decideApproval(root, approval.id, 'approved', 'test-user');
  assert.equal(loadApproval(root, approval.id).actor, 'test-user');
  assert.equal(approvalMatches(grant, request), true);
  assert.equal(approvalMatches(grant, { ...request, argumentHash: 'changed' }), false);
  assert.equal(approvalMatches(grant, { ...request, paths: ['README.md'] }), false);
  assert.equal(approvalMatches(grant, { ...request, runId: 'run-2' }), false);
  assert.throws(() => decideApproval(root, approval.id, 'rejected'), /already approved/u);
});
