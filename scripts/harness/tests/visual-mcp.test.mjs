import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { harnessRoot } from '../lib/paths.mjs';
import { registerRepository } from '../lib/registry.mjs';

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

test('visual MCP has a separate observation-only tool surface', async (context) => {
  const targetRoot = mkdtempSync(resolve(tmpdir(), 'ionic-visual-mcp-target-'));
  const stateRoot = mkdtempSync(resolve(tmpdir(), 'ionic-visual-mcp-state-'));
  git(targetRoot, 'init', '-b', 'main');
  git(targetRoot, 'config', 'user.name', 'Visual Test');
  git(targetRoot, 'config', 'user.email', 'visual@example.invalid');
  writeFileSync(resolve(targetRoot, 'README.md'), 'fixture\n');
  git(targetRoot, 'add', '.');
  git(targetRoot, 'commit', '-m', 'fixture');
  const repository = registerRepository(stateRoot, targetRoot);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(harnessRoot, 'scripts/harness/visual-mcp.mjs')],
    cwd: harnessRoot,
    env: {
      PATH: process.env.PATH,
      IONA_REPOSITORY_ID: repository.id,
      IONA_STATE_ROOT: stateRoot,
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'visual-test-client', version: '1.0.0' });
  context.after(async () => {
    await client.close();
    rmSync(targetRoot, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(({ name }) => name).sort(), [
    'begin',
    'compare',
    'dom_snapshot',
    'finish',
    'list_baselines',
    'list_targets',
    'measure',
    'report',
    'screenshot',
    'status',
  ]);
  assert.equal(
    tools.tools.some(({ name }) => name === 'apply_patch'),
    false,
  );
  const targets = await client.callTool({ name: 'list_targets', arguments: {} });
  assert.deepEqual(targets.structuredContent.targets, []);
});
