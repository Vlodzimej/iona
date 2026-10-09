import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { providerConfig, models, completion } from '../provider.mjs';
import { messageText } from '../../local-ai/lib/client.mjs';
const defaults = {
  provider: 'ollama',
  pairEngine: 'ollama',
  baseUrl: '',
  model: 'test-model',
  maximumTokens: 100,
  timeoutMs: 1000,
  temperature: 0.1,
};

test('provider defaults and PAIR use engine proxy ports and normalize the Endpoints URL', () => {
  assert.equal(providerConfig(defaults).baseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(
    providerConfig({ ...defaults, provider: 'lmstudio' }).baseUrl,
    'http://127.0.0.1:1234/v1',
  );
  for (const [pairEngine, port] of [
    ['ollama', 11434],
    ['lmstudio', 1234],
    ['llama.cpp', 8080],
  ]) {
    assert.equal(
      providerConfig({ ...defaults, provider: 'pair', pairEngine }).baseUrl,
      `http://127.0.0.1:${port}/v1`,
    );
  }
  assert.equal(
    providerConfig({ ...defaults, provider: 'pair', baseUrl: 'http://localhost:9999/' }).baseUrl,
    'http://localhost:9999/v1',
  );
  assert.throws(
    () => providerConfig({ ...defaults, provider: 'pair', baseUrl: 'http://cluster-node:1234' }),
    /loopback/,
  );
  for (const baseUrl of [
    'file:///tmp/api',
    'http://user:password@localhost',
    'http://localhost?key=secret',
  ])
    assert.throws(() => providerConfig({ ...defaults, baseUrl }));
  assert.throws(() => providerConfig({ ...defaults, maximumTokens: -1 }));
});

async function server(context, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return providerConfig({ ...defaults, baseUrl: `http://127.0.0.1:${server.address().port}` });
}

test('OpenAI-compatible transport discovers models, forwards tools, and omits reasoning by default', async (context) => {
  let body;
  const config = await server(context, async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer fixture-key');
    if (request.url === '/v1/models')
      response.end(JSON.stringify({ data: [{ id: 'test-model' }, { invalid: true }] }));
    else {
      let text = '';
      for await (const chunk of request) text += chunk;
      body = JSON.parse(text);
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: 'answer', reasoning_content: 'must not be displayed' },
            },
          ],
        }),
      );
    }
  });
  config.apiKey = 'fixture-key';
  assert.deepEqual(await models(config), ['test-model']);
  assert.equal(
    messageText(
      await completion(config, [{ role: 'user', content: 'question' }], [{ type: 'function' }]),
    ),
    'answer',
  );
  assert.equal(body.reasoning_effort, undefined);
  assert.deepEqual(body.tools, [{ type: 'function' }]);
});

test('HTTP errors never expose server text or keys; cancellation aborts model requests', async (context) => {
  const config = await server(context, (request, response) => {
    if (request.url === '/v1/models') {
      response.statusCode = 401;
      response.end('secret request content');
    }
  });
  await assert.rejects(
    models(config),
    (error) => error.message === 'Model server returned HTTP 401.',
  );
  const controller = new AbortController();
  const request = completion(config, [], undefined, controller.signal);
  controller.abort();
  await assert.rejects(request, (error) => error.name === 'AbortError');
});

test('truncated completions and raw service channels are rejected', () => {
  assert.throws(
    () => messageText({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }),
    /truncated/,
  );
  assert.throws(
    () => messageText({ choices: [{ message: { content: '<|channel|>analysis' } }] }),
    /rejected/,
  );
});

test('SSE chat handles fragmented frames, ignores reasoning, and rejects incomplete streams', async (context) => {
  const { streamChat } = await import('../provider.mjs');
  const config = await server(context, async (request, response) => {
    let text = '';
    for await (const bytes of request) text += bytes;
    assert.equal(JSON.parse(text).stream, true);
    response.setHeader('Content-Type', 'text/event-stream');
    response.write('data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"con');
    response.write('tent":"public answer"},"finish_reason":"stop"}]}\r\n\r\n');
    response.end('data: [DONE]\n\n');
  });
  assert.equal(messageText(await streamChat(config, [])), 'public answer');
  const broken = await server(context, (_, response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
  });
  await assert.rejects(streamChat(broken, []), /Incomplete/);
  const reasoning = await server(context, (_, response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.end('data: {"choices":[{"delta":{"content":"<think>private"}}]}\n\n');
  });
  await assert.rejects(streamChat(reasoning, []), /reasoning/);
});

test('stdio bridge runs without environment-based model configuration', async (context) => {
  const { spawn } = await import('node:child_process');
  const { createInterface } = await import('node:readline');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const config = await server(context, (_, response) =>
    response.end(JSON.stringify({ data: [{ id: 'bridge-model' }] })),
  );
  const stateRoot = mkdtempSync(resolve(tmpdir(), 'vscode-bridge-test-'));
  context.after(() => rmSync(stateRoot, { recursive: true, force: true }));
  const bridge = spawn(
    process.execPath,
    [fileURLToPath(new URL('../bridge.mjs', import.meta.url)), stateRoot],
    {
      env: { ...process.env, LOCAL_AI_BASE_URL: 'http://invalid.invalid' },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  context.after(() => bridge.kill());
  const lines = createInterface({ input: bridge.stdout });
  context.after(() => lines.close());
  const result = new Promise((resolve, reject) => {
    lines.once('line', (line) => resolve(JSON.parse(line)));
    bridge.once('error', reject);
    bridge.once('exit', (code) => reject(new Error('Bridge exited: ' + code)));
  });
  bridge.stdin.write(JSON.stringify({ id: 1, method: 'models', params: { config } }) + '\n');
  assert.deepEqual(await result, { id: 1, result: ['bridge-model'] });
});
