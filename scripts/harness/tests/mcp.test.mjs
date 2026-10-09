import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { harnessRoot } from '../lib/paths.mjs';
import { registerRepository } from '../lib/registry.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

test('stdio MCP server exposes only the controlled repository tool surface', async (context) => {
  const targetRoot = mkdtempSync(resolve(tmpdir(), 'ionic-harness-mcp-target-'));
  const stateRoot = mkdtempSync(resolve(tmpdir(), 'ionic-harness-mcp-state-'));
  git(targetRoot, 'init', '-b', 'main');
  git(targetRoot, 'config', 'user.name', 'Harness Test');
  git(targetRoot, 'config', 'user.email', 'harness@example.invalid');
  mkdirSync(resolve(targetRoot, 'src'));
  writeFileSync(resolve(targetRoot, 'src/app.ts'), 'export const value = 1;\n');
  git(targetRoot, 'add', '.');
  git(targetRoot, 'commit', '-m', 'fixture');
  const repository = registerRepository(stateRoot, targetRoot);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(harnessRoot, 'scripts/harness/mcp.mjs')],
    cwd: harnessRoot,
    env: {
      PATH: process.env.PATH,
      IONA_REPOSITORY_ID: repository.id,
      IONA_PROFILE: 'angular-ionic-capacitor',
      IONA_STATE_ROOT: stateRoot,
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'harness-test-client', version: '1.0.0' });
  context.after(async () => {
    await client.close();
    rmSync(targetRoot, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    'apply_patch',
    'begin',
    'finish',
    'git_diff',
    'list_files',
    'read_file',
    'run_checks',
    'search',
    'status',
  ]);
  const begun = await client.callTool({ name: 'begin', arguments: { task: 'Inspect the app.' } });
  assert.equal(begun.isError, false);
  const run = begun.structuredContent;
  const listed = await client.callTool({ name: 'list_files', arguments: { runId: run.runId } });
  assert.deepEqual(listed.structuredContent.files, ['src/app.ts']);
});
