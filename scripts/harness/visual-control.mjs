#!/usr/bin/env node
import { harnessStateRoot } from './lib/paths.mjs';
import { registerRepository } from './lib/registry.mjs';
import { VisualSessionManager } from './lib/visual-session.mjs';
import {
  listVisualAssets,
  registerVisualBaseline,
  registerVisualTarget,
} from './lib/visual-registry.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const stateRoot = harnessStateRoot({
  ...process.env,
  IONIC_HARNESS_STATE_ROOT: option('--state-root') || process.env.IONIC_HARNESS_STATE_ROOT,
});
const values = process.argv.slice(2).filter((value, index, all) => {
  if (['--state-root', '--name'].includes(value)) return false;
  return !['--state-root', '--name'].includes(all[index - 1]);
});
const [command, repositoryPath, value] = values;

try {
  if (!repositoryPath) throw new Error('A target repository path is required.');
  const repository = registerRepository(stateRoot, repositoryPath);
  let result;
  if (command === 'target' && value) {
    result = registerVisualTarget(stateRoot, repository.id, { name: option('--name'), url: value });
  } else if (command === 'baseline' && value) {
    result = registerVisualBaseline(stateRoot, repository.id, {
      name: option('--name'),
      imagePath: value,
    });
  } else if (command === 'list') {
    result = listVisualAssets(stateRoot, repository.id);
  } else if (command === 'status' && value) {
    const manager = new VisualSessionManager({ stateRoot, repositoryId: repository.id });
    result = {
      ...manager.status(value),
      artifactRoot: manager.runRoot(value),
    };
  } else {
    throw new Error(
      'Usage: visual-control <target REPOSITORY URL|baseline REPOSITORY PNG|list REPOSITORY|status REPOSITORY RUN>',
    );
  }
  console.log(JSON.stringify({ repositoryId: repository.id, ...result }, null, 2));
} catch (error) {
  console.error('Visual control failed: ' + error.message);
  process.exitCode = 1;
}
