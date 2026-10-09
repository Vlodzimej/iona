/* global acquireVsCodeApi, markdownit */
const vscode = acquireVsCodeApi();
const messages = document.getElementById('messages');
const status = document.getElementById('status');
const activity = document.getElementById('activity');
const activityText = document.getElementById('activity-text');
const activityTime = document.getElementById('activity-time');
const run = document.getElementById('run');
const task = document.getElementById('task');
const mode = document.getElementById('mode');
const sendButton = document.getElementById('send');
let busy = false;
let partial;
let hasRun = false;
let activityStartedAt = 0;
let activityTimer;
let activityLabel = '';
const runActions = new Set(['status', 'diff', 'continue', 'approve', 'reject', 'apply', 'discard']);
function elapsedText() {
  const seconds = Math.max(0, Math.floor((Date.now() - activityStartedAt) / 1000));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
function startActivity() {
  activityStartedAt = Date.now();
  setActivityText(mode.value === 'start' ? 'Working on task…' : 'Generating response…');
  activityTime.textContent = '0:00';
  activity.hidden = false;
  clearInterval(activityTimer);
  activityTimer = setInterval(() => {
    activityTime.textContent = elapsedText();
    if (Date.now() - activityStartedAt >= 30000)
      activityText.textContent = activityLabel + ' · still working; you can cancel';
  }, 1000);
}
function stopActivity() {
  clearInterval(activityTimer);
  activityTimer = undefined;
  activity.hidden = true;
}
function progressText(text) {
  return text.startsWith('Tool: ') ? 'Using ' + text.slice(6) + '…' : text;
}
function setActivityText(text) {
  activityLabel = text;
  activityText.textContent = text;
}
function refresh() {
  for (const button of document.querySelectorAll('button[data-action]')) {
    const action = button.dataset.action;
    button.disabled = action === 'cancel' ? !busy : busy || (runActions.has(action) && !hasRun);
    if (action === 'cancel') button.hidden = !busy;
  }
  sendButton.hidden = busy;
  sendButton.disabled = busy || !task.value.trim() || (mode.value === 'start' && hasRun);
  mode.disabled = busy;
  document.getElementById('run-card').hidden = !hasRun;
  document.getElementById('empty').hidden = messages.childElementCount > 0;
}
const markdown = markdownit({ html: false, linkify: false, typographer: false });
let copySequence = 0;
const copyRequests = new Map();

// Build only trusted DOM elements from parser tokens, never HTML supplied by the model.
function renderMarkdown(target, text) {
  const tags = {
    paragraph: 'div',
    heading: 'div',
    bullet_list: 'div',
    ordered_list: 'div',
    list_item: 'div',
    blockquote: 'div',
    table: 'div',
    thead: 'div',
    tbody: 'div',
    tr: 'div',
    th: 'div',
    td: 'div',
    strong: 'span',
    em: 'span',
    s: 'span',
    link: 'a',
  };
  function appendTokens(parent, tokens) {
    const stack = [parent];
    for (const token of tokens) {
      const current = stack.at(-1);
      if (token.nesting === -1) {
        if (stack.length > 1) stack.pop();
      } else if (token.nesting === 1) {
        const name = token.type.replace(/_open$/u, '');
        const element = document.createElement(tags[name] || 'span');
        element.className = 'md-' + name;
        if (name === 'heading') element.classList.add('md-' + token.tag);
        if (name === 'ordered_list') {
          const start = Number(token.attrGet('start') || 1);
          if (Number.isSafeInteger(start)) element.style.counterReset = 'md-item ' + (start - 1);
        }
        if (name === 'link') {
          try {
            const url = new URL(token.attrGet('href'));
            if (['https:', 'http:', 'mailto:'].includes(url.protocol)) {
              element.href = url.href;
              element.target = '_blank';
              element.rel = 'noopener noreferrer';
            }
          } catch {
            /* Unsupported links remain readable text. */
          }
        }
        current.append(element);
        stack.push(element);
      } else if (token.type === 'inline') {
        appendTokens(current, token.children || []);
      } else if (token.type === 'fence' || token.type === 'code_block') {
        const code = document.createElement('div');
        code.className = 'md-code-block';
        code.textContent = token.content;
        current.append(code);
      } else if (token.type === 'code_inline') {
        const code = document.createElement('span');
        code.className = 'md-code-inline';
        code.textContent = token.content;
        current.append(code);
      } else if (token.type === 'hr') {
        const rule = document.createElement('div');
        rule.className = 'md-rule';
        current.append(rule);
      } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
        current.append(document.createTextNode('\n'));
      } else {
        current.append(document.createTextNode(token.content));
      }
    }
  }
  target.replaceChildren();
  appendTokens(target, markdown.parse(text, {}));
}
function add(role, text, provisional = false) {
  const item = document.createElement('div');
  item.className = role === 'user' ? 'message message--user' : 'message';
  const heading = document.createElement('div');
  heading.className = 'message__heading';
  const label = document.createElement('span');
  label.className = 'speaker';
  label.textContent = role === 'user' ? 'You' : 'Assistant';
  heading.append(label);
  const body = document.createElement('div');
  body.className = role === 'user' ? 'message__body' : 'message__body markdown';
  if (role === 'user') body.textContent = text;
  else renderMarkdown(body, text);
  if (!provisional) {
    const copy = document.createElement('button');
    copy.className = 'message__copy';
    copy.type = 'button';
    copy.textContent = 'Copy';
    copy.title = 'Copy message as Markdown';
    copy.addEventListener('click', () => {
      const requestId = ++copySequence;
      copyRequests.set(requestId, copy);
      copy.disabled = true;
      vscode.postMessage({ type: 'copy', text, requestId });
    });
    heading.append(copy);
  }
  item.append(heading, body);
  messages.append(item);
  item.scrollIntoView({ block: 'end' });
  refresh();
  return item;
}
function submit() {
  if (sendButton.disabled) return;
  vscode.postMessage({
    type: mode.value,
    task: task.value,
    includeSelection: document.getElementById('include-selection').checked,
  });
}
sendButton.addEventListener('click', submit);
task.addEventListener('input', refresh);
mode.addEventListener('change', refresh);
task.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
});
for (const button of document.querySelectorAll('button[data-action]')) {
  button.addEventListener('click', () => {
    vscode.postMessage({ type: button.dataset.action });
    document.getElementById('tools').hidden = true;
  });
}
for (const [buttonId, menuId] of [
  ['settings-toggle', 'tools'],
  ['run-toggle', 'run-options'],
]) {
  document.getElementById(buttonId).addEventListener('click', () => {
    const menu = document.getElementById(menuId);
    menu.hidden = !menu.hidden;
  });
}
window.addEventListener('message', ({ data }) => {
  if (data.type === 'copied') {
    const button = copyRequests.get(data.requestId);
    if (button) {
      button.disabled = false;
      button.textContent = data.ok ? 'Copied' : 'Retry copy';
      button.title = data.ok ? 'Copy message again' : 'Copy failed; click to retry';
      copyRequests.delete(data.requestId);
    }
  }
  if (data.type === 'busy') {
    busy = data.value;
    if (busy) {
      status.textContent = '';
      status.hidden = true;
      status.classList.remove('status--error');
      startActivity();
    } else stopActivity();
    refresh();
  }
  if (data.type === 'run') {
    hasRun = Boolean(data.runId);
    run.textContent = hasRun ? 'Isolated task · ' + data.runId : '';
    refresh();
  }
  if (data.type === 'runStatus') run.textContent = 'Isolated task · ' + data.status;
  if (data.type === 'connection') {
    const model = document.getElementById('model');
    model.textContent = data.model || 'Select model';
    model.title = data.model || 'Select model';
    const providers = {
      ollama: 'Ollama',
      lmstudio: 'LM Studio',
      pair: 'NVIDIA PAIR',
      'openai-compatible': 'OpenAI compatible',
    };
    document.getElementById('provider').textContent = providers[data.provider] || data.provider;
  }
  if (data.type === 'accepted') {
    task.value = '';
    refresh();
  }
  if (data.type === 'chatPartial') {
    setActivityText('Writing response…');
    if (!partial) {
      partial = add('assistant', data.text, true);
    }
    renderMarkdown(partial.querySelector('.message__body'), data.text);
    refresh();
    partial.scrollIntoView({ block: 'end' });
  }
  if (data.type === 'message') {
    partial?.remove();
    partial = undefined;
    add(data.role, data.text);
  }
  if (data.type === 'error') {
    partial?.remove();
    partial = undefined;
    refresh();
  }
  if (data.type === 'progress' && busy) {
    setActivityText(progressText(data.text));
  } else if (data.type === 'progress' || data.type === 'error') {
    status.textContent = data.text;
    status.hidden = !data.text;
    status.classList.toggle('status--error', data.type === 'error');
  }
  if (data.type === 'history') {
    partial = undefined;
    copyRequests.clear();
    messages.replaceChildren();
    for (const item of data.messages) add(item.role, item.content);
    refresh();
  }
});
refresh();
vscode.postMessage({ type: 'ready' });
