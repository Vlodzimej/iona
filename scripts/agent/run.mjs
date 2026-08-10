#!/usr/bin/env node
import { runAgent } from './lib/runtime.mjs';

function parseArguments(args) {
  const taskParts = [];
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') {
      options.apply = true;
    } else if (argument === '--allow-protected') {
      options.allowProtected = true;
    } else if (argument === '--allow-host-execution') {
      options.allowHostExecution = true;
    } else if (argument === '--executor') {
      const value = args[index + 1];
      if (!['local', 'docker'].includes(value)) {
        return { task: '', options, error: '--executor must be local or docker.' };
      }
      options.executor = value;
      index += 1;
    } else if (argument === '--max-iterations') {
      const value = Number(args[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
        return { task: '', options, error: '--max-iterations must be between 1 and 100.' };
      }
      options.maximumIterations = value;
      index += 1;
    } else {
      taskParts.push(argument);
    }
  }
  return { task: taskParts.join(' ').trim(), options };
}

const parsed = parseArguments(process.argv.slice(2));
if (!parsed.task || parsed.error) {
  if (parsed.error) {
    console.error(parsed.error);
  }
  console.error(
    'Usage: npm run agent -- "task" [--apply] [--allow-protected] [--executor local|docker] [--allow-host-execution] [--max-iterations 16]',
  );
  process.exit(2);
}

try {
  const result = await runAgent(parsed.task, parsed.options);
  if (result.status === 'waiting_approval') {
    console.log('Agent paused for approval.');
    console.log('Run: ' + result.runId);
    console.log('Approval: ' + result.approval.id);
    console.log('Protected paths: ' + result.approval.paths.join(', '));
    console.log('Approve: npm run agent:approve -- ' + result.approval.id);
    console.log('Reject: npm run agent:reject -- ' + result.approval.id);
    console.log('Resume: npm run agent:resume -- ' + result.runId);
    process.exit(0);
  }
  console.log('Agent completed: ' + result.summary);
  console.log('Run: ' + result.runId);
  console.log('Worktree: ' + result.worktreeRoot);
  console.log('Changes applied to primary worktree: ' + (result.applied ? 'yes' : 'no'));
  if (!result.applied && result.patch) {
    console.log('Review the worktree diff before applying it manually.');
  }
} catch (error) {
  console.error('Agent failed: ' + error.message);
  if (error.agentRun) {
    console.error('Run log: ' + error.agentRun.eventPath);
    if (error.agentRun.worktreeRetained !== false) {
      console.error('Worktree retained at: ' + error.agentRun.worktreeRoot);
    }
  }
  process.exitCode = 1;
}
