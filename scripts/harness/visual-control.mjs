#!/usr/bin/env node
import { harnessStateRoot } from './lib/paths.mjs';
import { registerRepository } from './lib/registry.mjs';
import { VisualSessionManager } from './lib/visual-session.mjs';
import {
  listVisualAssets,
  registerVisualBaseline,
  registerAndroidWebViewTarget,
  registerAppiumWebViewTarget,
  registerIosSimulatorTarget,
  registerVisualTarget,
} from './lib/visual-registry.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const stateRoot = harnessStateRoot({
  ...process.env,
  IONA_STATE_ROOT: option('--state-root') || process.env.IONA_STATE_ROOT,
});
const values = process.argv.slice(2).filter((value, index, all) => {
  if (
    [
      '--state-root',
      '--name',
      '--serial',
      '--application-id',
      '--udid',
      '--bundle-id',
      '--url',
      '--session-id',
      '--platform',
    ].includes(value)
  )
    return false;
  return ![
    '--state-root',
    '--name',
    '--serial',
    '--application-id',
    '--udid',
    '--bundle-id',
    '--url',
    '--session-id',
    '--platform',
  ].includes(all[index - 1]);
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
  } else if (command === 'android-webview') {
    result = registerAndroidWebViewTarget(stateRoot, repository.id, {
      name: option('--name'),
      serial: option('--serial'),
      applicationId: option('--application-id'),
    });
  } else if (command === 'ios-simulator') {
    result = registerIosSimulatorTarget(stateRoot, repository.id, {
      name: option('--name'),
      udid: option('--udid'),
      bundleId: option('--bundle-id'),
    });
  } else if (command === 'appium-webview') {
    result = registerAppiumWebViewTarget(stateRoot, repository.id, {
      name: option('--name'),
      url: option('--url'),
      sessionId: option('--session-id'),
      platform: option('--platform'),
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
      'Usage: visual-control <target REPOSITORY URL|android-webview REPOSITORY --serial ID --application-id ID|ios-simulator REPOSITORY --udid ID [--bundle-id ID]|appium-webview REPOSITORY --url URL --session-id ID --platform ios|android|baseline REPOSITORY PNG|list REPOSITORY|status REPOSITORY RUN>',
    );
  }
  console.log(JSON.stringify({ repositoryId: repository.id, ...result }, null, 2));
} catch (error) {
  console.error('Visual control failed: ' + error.message);
  process.exitCode = 1;
}
