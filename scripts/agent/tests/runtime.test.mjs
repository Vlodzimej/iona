import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function copyFixture() {
  const parent = mkdtempSync(resolve(tmpdir(), 'iona-agent-runtime-'));
  const root = resolve(parent, 'repository');
  cpSync(repositoryRoot, root, {
    recursive: true,
    filter(source) {
      const path = relative(repositoryRoot, source).replaceAll('\\', '/');
      return !['.git', '.agent', 'node_modules', 'dist', '.env.local-ai'].some(
        (excluded) => path === excluded || path.startsWith(excluded + '/'),
      );
    },
  });
  symlinkSync(resolve(repositoryRoot, 'node_modules'), resolve(root, 'node_modules'), 'dir');
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Agent Runtime Test');
  git(root, 'config', 'user.email', 'agent@example.invalid');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  return { parent, root };
}

function run(root, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, encoding: 'utf8' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => resolvePromise({ status, stdout, stderr }));
  });
}

test('CLI rejects an invalid iteration limit before starting a model run', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/agent/run.mjs', 'task', '--max-iterations', 'invalid'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /between 1 and 100/u);
  assert.doesNotMatch(result.stderr, /LOCAL_AI_BASE_URL/u);
});

test(
  'agent loop executes tool calls, validates a worktree, and applies the patch explicitly',
  { skip: process.env.LOCAL_AGENT_SKIP_INTEGRATION === '1', timeout: 120000 },
  async (context) => {
    const fixture = copyFixture();
    context.after(() => rmSync(fixture.parent, { recursive: true, force: true }));
    let completion = 0;
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/v1/models') {
        response.end(JSON.stringify({ data: [{ id: 'agent-test-model' }] }));
        return;
      }
      if (request.url !== '/v1/chat/completions') {
        response.statusCode = 404;
        response.end('{}');
        return;
      }

      const toolCalls = [
        {
          id: 'read-call',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: 'src/app/app.scss' }),
          },
        },
        {
          id: 'patch-call',
          type: 'function',
          function: {
            name: 'apply_patch',
            arguments: JSON.stringify({
              patch: [
                'diff --git a/src/app/app.scss b/src/app/app.scss',
                '--- a/src/app/app.scss',
                '+++ b/src/app/app.scss',
                '@@ -0,0 +1 @@',
                '+/* Agent runtime integration fixture. */',
                '',
              ].join('\n'),
            }),
          },
        },
        {
          id: 'finish-call',
          type: 'function',
          function: {
            name: 'finish',
            arguments: JSON.stringify({ summary: 'Added the integration fixture style.' }),
          },
        },
      ];
      const toolCall = toolCalls[completion];
      completion += 1;
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: { role: 'assistant', content: null, tool_calls: [toolCall] },
            },
          ],
        }),
      );
    });
    await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
    context.after(() => server.close());
    const address = server.address();
    writeFileSync(
      resolve(fixture.root, '.env.local-ai'),
      [
        'LOCAL_AI_BASE_URL=http://127.0.0.1:' + address.port + '/v1',
        'LOCAL_AI_MODEL=agent-test-model',
        'LOCAL_AI_TIMEOUT_MS=120000',
        'LOCAL_AGENT_ALLOW_HOST_EXECUTION=1',
        'LOCAL_AGENT_EXECUTOR=local',
        'LOCAL_AGENT_SKIP_INTEGRATION=1',
        '',
      ].join('\n'),
    );

    const result = await run(fixture.root, [
      'scripts/agent/run.mjs',
      'Add the integration fixture style',
      '--apply',
      '--max-iterations',
      '4',
    ]);
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, /Changes applied to primary worktree: yes/u);
    assert.equal(completion, 3);
    assert.equal(
      readFileSync(resolve(fixture.root, 'src/app/app.scss'), 'utf8'),
      '/* Agent runtime integration fixture. */\n',
    );
  },
);

test(
  'protected changes pause the run and resume only after exact approval',
  { skip: process.env.LOCAL_AGENT_SKIP_INTEGRATION === '1', timeout: 120000 },
  async (context) => {
    const fixture = copyFixture();
    context.after(() => rmSync(fixture.parent, { recursive: true, force: true }));
    let completion = 0;
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/v1/models') {
        response.end(JSON.stringify({ data: [{ id: 'approval-test-model' }] }));
        return;
      }
      if (request.url !== '/v1/chat/completions') {
        response.statusCode = 404;
        response.end('{}');
        return;
      }
      const toolCalls = [
        {
          id: 'protected-patch',
          type: 'function',
          function: {
            name: 'apply_patch',
            arguments: JSON.stringify({
              patch: [
                'diff --git a/ai/approval-fixture.md b/ai/approval-fixture.md',
                'new file mode 100644',
                '--- /dev/null',
                '+++ b/ai/approval-fixture.md',
                '@@ -0,0 +1 @@',
                '+# Approval fixture',
                '',
              ].join('\n'),
            }),
          },
        },
        {
          id: 'approval-finish',
          type: 'function',
          function: {
            name: 'finish',
            arguments: JSON.stringify({ summary: 'Added an approved protected file.' }),
          },
        },
      ];
      const toolCall = toolCalls[completion];
      completion += 1;
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: { role: 'assistant', content: null, tool_calls: [toolCall] },
            },
          ],
        }),
      );
    });
    await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
    context.after(() => server.close());
    const address = server.address();
    writeFileSync(
      resolve(fixture.root, '.env.local-ai'),
      [
        'LOCAL_AI_BASE_URL=http://127.0.0.1:' + address.port + '/v1',
        'LOCAL_AI_MODEL=approval-test-model',
        'LOCAL_AI_TIMEOUT_MS=120000',
        'LOCAL_AGENT_ALLOW_HOST_EXECUTION=1',
        'LOCAL_AGENT_EXECUTOR=local',
        'LOCAL_AGENT_SKIP_INTEGRATION=1',
        '',
      ].join('\n'),
    );

    const initial = await run(fixture.root, [
      'scripts/agent/run.mjs',
      'Add an approval fixture',
      '--apply',
      '--max-iterations',
      '3',
    ]);
    assert.equal(initial.status, 0, initial.stdout + '\n' + initial.stderr);
    assert.match(initial.stdout, /paused for approval/u);
    assert.equal(completion, 1);
    assert.equal(readFileSync(resolve(fixture.root, 'ai/README.md'), 'utf8').length > 0, true);
    const approvalId = /Approval: (approval-[a-z0-9-]+)/u.exec(initial.stdout)?.[1];
    const runId = /Run: ([a-zA-Z0-9-]+)/u.exec(initial.stdout)?.[1];
    assert.ok(approvalId);
    assert.ok(runId);

    const approved = spawnSync(
      process.execPath,
      ['scripts/agent/control.mjs', 'approve', approvalId, '--actor', 'integration-test'],
      { cwd: fixture.root, encoding: 'utf8' },
    );
    assert.equal(approved.status, 0, approved.stdout + '\n' + approved.stderr);
    const resumed = await run(fixture.root, ['scripts/agent/control.mjs', 'resume', runId]);
    assert.equal(resumed.status, 0, resumed.stdout + '\n' + resumed.stderr);
    assert.match(resumed.stdout, /"status": "completed"/u);
    assert.equal(completion, 2);
    assert.equal(
      readFileSync(resolve(fixture.root, 'ai/approval-fixture.md'), 'utf8'),
      '# Approval fixture\n',
    );
  },
);
