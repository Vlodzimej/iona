import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEnforcedOpenCodeConfig,
  parseHarnessLauncherArguments,
} from '../lib/harness-config.mjs';

test('OpenCode harness launcher separates its flags from OpenCode arguments', () => {
  assert.deepEqual(
    parseHarnessLauncherArguments(
      ['--repo', '/target', '--profile', 'strict', 'run', 'Inspect the app'],
      '/default',
    ),
    {
      repositoryPath: '/target',
      profile: 'strict',
      stateRoot: undefined,
      visual: false,
      forwarded: ['run', 'Inspect the app'],
    },
  );
  assert.throws(() => parseHarnessLauncherArguments(['--repo'], '/default'), /requires a value/u);
});

test('enforced OpenCode config denies built-ins and exposes only harness MCP tools', () => {
  const config = createEnforcedOpenCodeConfig({
    harnessRoot: '/harness',
    nodeExecutable: '/node',
    repositoryId: 'project-123456789abc',
    profile: 'angular-ionic-capacitor',
    stateRoot: '/state',
  });
  assert.equal(config.permission['*'], 'deny');
  assert.equal(config.permission['ionic_harness_*'], 'allow');
  assert.equal(config.permission.skill, 'allow');
  assert.equal(config.permission.edit, undefined);
  assert.deepEqual(config.mcp.ionic_harness.command, ['/node', '/harness/scripts/harness/mcp.mjs']);
  assert.equal(
    config.mcp.ionic_harness.environment.IONIC_HARNESS_REPOSITORY_ID,
    'project-123456789abc',
  );
  assert.deepEqual(config.instructions, ['/harness/ai/prompts/opencode-harness.md']);
  assert.equal(config.permission['ionic_visual_*'], undefined);
  assert.equal(config.mcp.ionic_visual, undefined);
});

test('visual tools require an explicit launcher flag and use a separate MCP namespace', () => {
  const parsed = parseHarnessLauncherArguments(
    ['--repo', '/target', '--visual', 'run', 'Inspect layout'],
    '/default',
  );
  assert.equal(parsed.visual, true);
  assert.deepEqual(parsed.forwarded, ['run', 'Inspect layout']);
  const config = createEnforcedOpenCodeConfig({
    harnessRoot: '/harness',
    nodeExecutable: '/node',
    repositoryId: 'project-123456789abc',
    profile: 'angular-ionic-capacitor',
    stateRoot: '/state',
    visual: true,
  });
  assert.equal(config.permission['ionic_visual_*'], 'allow');
  assert.deepEqual(config.mcp.ionic_visual.command, [
    '/node',
    '/harness/scripts/harness/visual-mcp.mjs',
  ]);
  assert.deepEqual(config.instructions, [
    '/harness/ai/prompts/opencode-harness.md',
    '/harness/ai/prompts/opencode-visual.md',
  ]);
});
