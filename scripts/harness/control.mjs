#!/usr/bin/env node
import { harnessRoot, harnessStateRoot } from './lib/paths.mjs';
import { prepareProjectRunner } from './lib/dependencies.mjs';
import { registerRepository, repositoryStateRoot } from './lib/registry.mjs';
import { HarnessSessionManager } from './lib/session.mjs';
import { decideHarnessApproval, loadHarnessRun } from './lib/store.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function manager(stateRoot, repositoryId, profileId) {
  return new HarnessSessionManager({
    harnessRoot,
    stateRoot,
    repositoryId,
    profileId,
    executor: 'docker',
  });
}

const stateRoot = harnessStateRoot({
  ...process.env,
  IONA_STATE_ROOT: option('--state-root') || process.env.IONA_STATE_ROOT,
});
const profileOption = option('--profile') || 'angular-ionic-capacitor';
const positional = process.argv.slice(2).filter((value, index, values) => {
  if (['--state-root', '--profile', '--actor'].includes(value)) {
    return false;
  }
  return !['--state-root', '--profile', '--actor'].includes(values[index - 1]);
});
const [command, first, second] = positional;

try {
  let result;
  if (command === 'register' && first) {
    result = registerRepository(stateRoot, first);
  } else if (command === 'prepare' && first) {
    const repository = registerRepository(stateRoot, first);
    result = {
      repositoryId: repository.id,
      ...prepareProjectRunner({
        harnessRoot,
        stateRoot,
        projectRoot: repository.root,
      }),
    };
  } else if (command === 'status' && first && second) {
    const state = loadHarnessRun(repositoryStateRoot(stateRoot, first), second);
    result = manager(stateRoot, first, state.profile).status(second, {
      includePatch: process.argv.includes('--include-patch'),
      includeInternalPaths: true,
    });
  } else if (['approve', 'reject'].includes(command) && first && second) {
    result = decideHarnessApproval(
      repositoryStateRoot(stateRoot, first),
      second,
      command === 'approve' ? 'approved' : 'rejected',
      option('--actor') || process.env.USER || 'local-user',
    );
  } else if (['apply', 'discard'].includes(command) && first && second) {
    const state = loadHarnessRun(repositoryStateRoot(stateRoot, first), second);
    const session = manager(stateRoot, first, state.profile || profileOption);
    result = command === 'apply' ? session.apply(second) : session.discard(second);
  } else {
    throw new Error(
      'Usage: harness <register PATH|prepare PATH|status REPOSITORY RUN|approve REPOSITORY APPROVAL|reject REPOSITORY APPROVAL|apply REPOSITORY RUN|discard REPOSITORY RUN>',
    );
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Harness control failed: ' + error.message);
  process.exitCode = 1;
}
