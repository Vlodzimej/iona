import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { renderWebview } from '../../../extensions/vscode/src/webview.ts';
const root = new URL('../../../extensions/vscode/media/', import.meta.url);
function panel(context) {
  const dom = new JSDOM(readFileSync(new URL('panel.html', root), 'utf8'), {
    runScripts: 'outside-only',
  });
  context.after(() => dom.window.close());
  const actions = [];
  dom.window.acquireVsCodeApi = () => ({ postMessage: (message) => actions.push(message) });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.eval(
    readFileSync(
      new URL(
        '../../../extensions/vscode/node_modules/markdown-it/dist/browser/markdown-it.umd.min.js',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  dom.window.eval(readFileSync(new URL('panel.js', root), 'utf8'));
  return {
    document: dom.window.document,
    actions,
    window: dom.window,
    send: (data) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data })),
  };
}
test('formatted webview placeholders resolve script, styles and CSP nonce', () => {
  const html = renderWebview(readFileSync(new URL('panel.html', root), 'utf8'), {
    csp: 'vscode-webview://test',
    nonce: 'fixture-nonce',
    script: 'vscode-resource://panel.js',
    style: 'vscode-resource://panel.css',
    markdown: 'vscode-resource://markdown-it.min.js',
  });
  assert.doesNotMatch(html, /{{/);
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('script').getAttribute('nonce'), 'fixture-nonce');
  assert.equal(
    document.querySelectorAll('script')[1].getAttribute('src'),
    'vscode-resource://panel.js',
  );
  assert.equal(
    document.querySelector('script').getAttribute('src'),
    'vscode-resource://markdown-it.min.js',
  );
  assert.match(
    document.querySelector('meta[http-equiv]').content,
    /script-src 'nonce-fixture-nonce'/,
  );
});
test('panel serializes actions, renders content as text and removes rejected provisional output', (context) => {
  const { document, actions, send, window } = panel(context);
  assert.deepEqual(
    actions.map((item) => item.type),
    ['ready'],
  );
  assert.equal(document.getElementById('run-card').hidden, true);
  send({ type: 'run', runId: 'fixture' });
  assert.equal(document.getElementById('run-card').hidden, false);
  send({ type: 'error', text: 'Previous request failed.' });
  assert.equal(document.getElementById('status').hidden, false);
  send({ type: 'busy', value: true });
  assert.equal(document.getElementById('send').hidden, true);
  assert.equal(document.getElementById('status').hidden, true);
  assert.equal(document.getElementById('status').textContent, '');
  assert.equal(document.getElementById('status').classList.contains('status--error'), false);
  assert.equal(document.querySelector('[data-action="cancel"]').disabled, false);
  assert.equal(document.getElementById('activity').hidden, false);
  assert.equal(document.getElementById('activity-text').textContent, 'Generating response…');
  send({ type: 'progress', text: 'Tool: git_diff' });
  assert.equal(document.getElementById('activity-text').textContent, 'Using git_diff…');
  send({ type: 'chatPartial', text: '<img src=x onerror=alert(1)>' });
  assert.equal(document.getElementById('activity-text').textContent, 'Writing response…');
  assert.equal(document.querySelector('#messages img'), null);
  send({ type: 'error', text: 'Truncated; rejected.' });
  assert.equal(document.querySelector('#messages').textContent, '');
  assert.equal(document.getElementById('empty').hidden, false);
  send({ type: 'busy', value: false });
  assert.equal(document.getElementById('activity').hidden, true);
  document.getElementById('task').value = 'Question';
  document.getElementById('task').dispatchEvent(new window.Event('input'));
  document.getElementById('send').click();
  assert.equal(actions.at(-1).type, 'chat');
  assert.equal(actions.at(-1).task, 'Question');
});
test('composer submits agent tasks, preserves drafts before acceptance and supports Enter', (context) => {
  const { document, actions, send, window } = panel(context);
  const task = document.getElementById('task');
  const mode = document.getElementById('mode');
  mode.value = 'start';
  mode.dispatchEvent(new window.Event('change'));
  task.value = 'Change the app';
  task.dispatchEvent(new window.Event('input'));
  task.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
  assert.equal(actions.length, 1);
  task.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.equal(actions.at(-1).type, 'start');
  assert.equal(task.value, 'Change the app');
  send({ type: 'accepted' });
  assert.equal(task.value, '');
  send({ type: 'connection', provider: 'pair', model: 'model-id' });
  assert.equal(document.getElementById('provider').textContent, 'NVIDIA PAIR');
  assert.equal(document.getElementById('model').textContent, 'model-id');
});

test('assistant Markdown renders tables, lists and code without executing model HTML', (context) => {
  const { document, send } = panel(context);
  const text =
    '# Result\n\n**bold** and *italic* with `code`\n\n- first\n- second\n\n| Tool | Result |\n| --- | --- |\n| git_diff | OK |\n\n```html\n<img src=x onerror=alert(1)>\n```\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1)) [safe](https://example.com)';
  send({ type: 'message', role: 'assistant', text });
  assert.equal(document.querySelector('.md-heading').textContent, 'Result');
  assert.equal(document.querySelector('.md-strong').textContent, 'bold');
  assert.equal(document.querySelector('.md-em').textContent, 'italic');
  assert.equal(document.querySelector('.md-code-inline').textContent, 'code');
  assert.equal(document.querySelectorAll('.md-list_item').length, 2);
  assert.equal(document.querySelectorAll('.md-th').length, 2);
  assert.equal(document.querySelector('.md-td').textContent, 'git_diff');
  assert.match(document.querySelector('.md-code-block').textContent, /<img/);
  assert.equal(document.querySelector('#messages img, #messages script'), null);
  assert.equal(document.querySelectorAll('#messages a').length, 1);
  assert.equal(document.querySelector('#messages a').href, 'https://example.com/');
  assert.equal(
    document.querySelector('#messages h1, #messages p, #messages strong, #messages em'),
    null,
  );
});
test('fenced code uses safe theme-aware syntax tokens', (context) => {
  const { document, send } = panel(context);
  send({
    type: 'message',
    role: 'assistant',
    text: '```ts\nconst title: string = "Iona"; // visible\n```\n\n```diff\n-old\n+new\n```',
  });

  const blocks = document.querySelectorAll('.md-code-block');
  assert.equal(blocks[0].dataset.language, 'ts');
  assert.equal(blocks[0].querySelector('.syntax-keyword').textContent, 'const');
  assert.equal(blocks[0].querySelector('.syntax-string').textContent, '"Iona"');
  assert.equal(blocks[0].querySelector('.syntax-comment').textContent, '// visible');
  assert.equal(blocks[1].querySelector('.syntax-diff-remove').textContent, '-old\n');
  assert.equal(blocks[1].querySelector('.syntax-diff-add').textContent, '+new\n');
  assert.equal(document.querySelectorAll('.md-code-block script').length, 0);
});
test('incomplete pipe tables render as readable labeled list items', (context) => {
  const { document, send } = panel(context);
  send({
    type: 'message',
    role: 'assistant',
    text: '| Обновление | Обновляет данные |\n| Переиспользование | Общий компонент |',
  });

  const items = document.querySelectorAll('.md-list_item');
  assert.equal(items.length, 2);
  assert.equal(items[0].textContent, 'Обновление: Обновляет данные');
  assert.equal(items[1].textContent, 'Переиспользование: Общий компонент');
  assert.equal(document.querySelectorAll('.md-table').length, 0);
});
test('copy sends exact original Markdown and waits for clipboard acknowledgement', (context) => {
  const { document, send, actions } = panel(context);
  const text = '**Hello**\n\n```ts\nconst n = 1;\n```';
  send({
    type: 'history',
    messages: [
      { role: 'assistant', content: text },
      { role: 'user', content: 'Question' },
    ],
  });
  const buttons = document.querySelectorAll('.message__copy');
  assert.equal(buttons.length, 2);
  buttons[0].click();
  const request = actions.at(-1);
  assert.equal(request.type, 'copy');
  assert.equal(request.text, text);
  assert.equal(buttons[0].disabled, true);
  send({ type: 'copied', requestId: request.requestId, ok: true });
  assert.equal(buttons[0].textContent, 'Copied');
  assert.equal(buttons[0].disabled, false);
  buttons[1].click();
  send({ type: 'copied', requestId: actions.at(-1).requestId, ok: false });
  assert.equal(buttons[1].textContent, 'Retry copy');
  assert.equal(buttons[1].disabled, false);
  send({ type: 'chatPartial', text: '**partial**' });
  assert.equal(document.querySelectorAll('.message__copy').length, 2);
  send({ type: 'error', text: 'Rejected.' });
  assert.equal(document.querySelectorAll('.message').length, 2);
});
