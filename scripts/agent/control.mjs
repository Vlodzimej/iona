#!/usr/bin/env node
import { decideApproval } from './lib/approval.mjs';
import { getAgentRun, resumeAgent } from './lib/runtime.mjs';
import { projectRoot } from '../local-ai/lib/env.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function printRun(result) {
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'waiting_approval') {
    console.log('\nApprove: npm run agent:approve -- ' + result.approval.id);
    console.log('Reject:  npm run agent:reject -- ' + result.approval.id);
    console.log('Resume:  npm run agent:resume -- ' + result.runId);
  }
}

const [command, identifier] = process.argv.slice(2);
if (!command || !identifier) {
  console.error('Usage: node scripts/agent/control.mjs <status|approve|reject|resume> <id>');
  process.exit(2);
}

try {
  if (command === 'status') {
    printRun(getAgentRun(identifier, { includePatch: process.argv.includes('--include-patch') }));
  } else if (command === 'approve' || command === 'reject') {
    const decision = command === 'approve' ? 'approved' : 'rejected';
    const approval = decideApproval(
      projectRoot,
      identifier,
      decision,
      argument('--actor') || process.env.USER || 'local-user',
    );
    console.log('Approval ' + approval.id + ' is ' + approval.status + '.');
    console.log('Resume: npm run agent:resume -- ' + approval.runId);
  } else if (command === 'resume') {
    printRun(await resumeAgent(identifier));
  } else {
    throw new Error('Unknown command: ' + command);
  }
} catch (error) {
  console.error('Agent control failed: ' + error.message);
  process.exitCode = 1;
}
