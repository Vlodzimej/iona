import assert from 'node:assert/strict';
import test from 'node:test';
import { completionMessage, toolRequests } from '../lib/protocol.mjs';

test('native OpenAI tool calls are normalized', () => {
  const message = completionMessage({
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"package.json"}' },
            },
          ],
        },
      },
    ],
  });
  assert.deepEqual(toolRequests(message)[0], {
    id: 'call-1',
    name: 'read_file',
    arguments: { path: 'package.json' },
    native: true,
    original: message.tool_calls[0],
  });
});

test('strict JSON content is supported as a compatibility fallback', () => {
  const requests = toolRequests({
    content: '```json\n{"tool":"git_diff","arguments":{}}\n```',
  });
  assert.equal(requests[0].name, 'git_diff');
  assert.equal(requests[0].native, false);
  assert.deepEqual(toolRequests({ content: '{"tool":"git_diff","arguments":[]}' }), []);
});

test('truncated responses are rejected and malformed tool arguments are recoverable', () => {
  assert.throws(
    () => completionMessage({ choices: [{ finish_reason: 'length', message: {} }] }),
    /truncated/u,
  );
  const malformed = toolRequests({
    tool_calls: [{ id: 'bad', type: 'function', function: { name: 'read_file', arguments: '{' } }],
  });
  assert.match(malformed[0].invalidArguments, /JSON/u);
});
