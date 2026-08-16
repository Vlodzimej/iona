import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const categories = new Set([
  'angular',
  'ionic',
  'capacitor',
  'hybrid-architecture',
  'testing',
  'security',
]);
const skillNames = new Set([
  'angular-developer',
  'capacitor-plugins',
  'ionic-native-essentials',
  'ionic-deep-links',
]);
const checkTypes = new Set(['contains', 'contains-any', 'not-contains', 'not-matches']);

function requireString(value, label, minimumLength = 1) {
  if (typeof value !== 'string' || value.trim().length < minimumLength) {
    throw new Error(label + ' must be a string with at least ' + minimumLength + ' characters.');
  }
}

function requireStringArray(value, label, allowedValues) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(label + ' must be a non-empty array.');
  }
  for (const entry of value) {
    requireString(entry, label + ' entry');
    if (allowedValues && !allowedValues.has(entry)) {
      throw new Error(label + ' contains unsupported value ' + entry + '.');
    }
  }
  if (new Set(value).size !== value.length) {
    throw new Error(label + ' must not contain duplicates.');
  }
}

export function validateEvaluationTask(task, source = 'evaluation task') {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new Error(source + ' must contain a JSON object.');
  }

  const allowedKeys = new Set([
    'id',
    'title',
    'category',
    'prompt',
    'readOnly',
    'expectedSkills',
    'expectedReferences',
    'checks',
    'timeoutSeconds',
  ]);
  const unknownKeys = Object.keys(task).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(source + ' contains unknown properties: ' + unknownKeys.join(', ') + '.');
  }

  requireString(task.id, source + '.id', 2);
  if (!/^[a-z0-9][a-z0-9-]+$/u.test(task.id)) {
    throw new Error(source + '.id must use lowercase letters, digits, and hyphens.');
  }
  requireString(task.title, source + '.title', 3);
  requireString(task.prompt, source + '.prompt', 10);
  if (!categories.has(task.category)) {
    throw new Error(source + '.category is unsupported.');
  }
  if (task.readOnly !== true) {
    throw new Error(source + '.readOnly must be true.');
  }
  requireStringArray(task.expectedSkills, source + '.expectedSkills', skillNames);
  if (task.expectedReferences !== undefined) {
    requireStringArray(task.expectedReferences, source + '.expectedReferences');
  }
  if (!Array.isArray(task.checks) || task.checks.length === 0) {
    throw new Error(source + '.checks must be a non-empty array.');
  }
  for (const [index, check] of task.checks.entries()) {
    if (!check || typeof check !== 'object' || Array.isArray(check)) {
      throw new Error(source + '.checks[' + index + '] must be an object.');
    }
    const unknownCheckKeys = Object.keys(check).filter((key) => key !== 'type' && key !== 'values');
    if (unknownCheckKeys.length > 0) {
      throw new Error(
        source +
          '.checks[' +
          index +
          '] contains unknown properties: ' +
          unknownCheckKeys.join(', ') +
          '.',
      );
    }
    if (!checkTypes.has(check.type)) {
      throw new Error(source + '.checks[' + index + '].type is unsupported.');
    }
    requireStringArray(check.values, source + '.checks[' + index + '].values');
    if (check.type === 'not-matches') {
      for (const pattern of check.values) {
        if (pattern.length > 200) {
          throw new Error(source + '.checks[' + index + '] regex is too long.');
        }
        try {
          new RegExp(pattern, 'iu');
        } catch {
          throw new Error(source + '.checks[' + index + '] contains an invalid regex.');
        }
      }
    }
  }
  if (
    task.timeoutSeconds !== undefined &&
    (!Number.isInteger(task.timeoutSeconds) ||
      task.timeoutSeconds < 1 ||
      task.timeoutSeconds > 3600)
  ) {
    throw new Error(source + '.timeoutSeconds must be an integer from 1 to 3600.');
  }

  return task;
}

export function loadEvaluationTasks(directory, selectedIds = []) {
  const selected = new Set(selectedIds);
  const tasks = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const path = resolve(directory, entry.name);
      return validateEvaluationTask(JSON.parse(readFileSync(path, 'utf8')), path);
    });

  const duplicate = tasks.find(
    (task, index) => tasks.findIndex((candidate) => candidate.id === task.id) !== index,
  );
  if (duplicate) {
    throw new Error('Duplicate evaluation task id: ' + duplicate.id + '.');
  }

  if (selected.size === 0) {
    return tasks;
  }
  const filtered = tasks.filter((task) => selected.has(task.id));
  const missing = [...selected].filter((id) => !filtered.some((task) => task.id === id));
  if (missing.length > 0) {
    throw new Error('Unknown evaluation task id: ' + missing.join(', ') + '.');
  }
  return filtered;
}

function selectedSkillNames(context) {
  return context.skills.map((skill) => skill.name);
}

function selectedReferenceSources(context) {
  return context.skills.flatMap((skill) =>
    skill.references.map((reference) => reference.source.replace(/^~\/.agents\/skills\//u, '')),
  );
}

export function evaluateRetrieval(task, context) {
  const skills = selectedSkillNames(context);
  const references = selectedReferenceSources(context);
  const checks = [
    ...task.expectedSkills.map((value) => ({
      type: 'expected-skill',
      value,
      passed: skills.includes(value),
    })),
    ...(task.expectedReferences ?? []).map((value) => ({
      type: 'expected-reference',
      value,
      passed: references.includes(value),
    })),
  ];
  return {
    passed: checks.every((check) => check.passed),
    checks,
    skills,
    references,
    bytes: context.selection?.totalBytes ?? 0,
  };
}

export function evaluateResponse(task, responseText) {
  const normalized = responseText.toLocaleLowerCase('ru-RU');
  const checks = task.checks.flatMap((group) =>
    group.type === 'contains-any'
      ? [
          {
            type: group.type,
            value: group.values.join(' | '),
            passed: group.values.some((value) =>
              normalized.includes(value.toLocaleLowerCase('ru-RU')),
            ),
          },
        ]
      : group.values.map((value) => {
          const present =
            group.type === 'not-matches'
              ? new RegExp(value, 'iu').test(responseText)
              : normalized.includes(value.toLocaleLowerCase('ru-RU'));
          return {
            type: group.type,
            value,
            passed: group.type === 'contains' ? present : !present,
          };
        }),
  );
  return { passed: checks.every((check) => check.passed), checks };
}

export function evaluateGrounding(task, responseText) {
  const normalized = responseText.toLocaleLowerCase('ru-RU');
  const checks = (task.expectedReferences ?? []).map((value) => ({
    type: 'cited-reference',
    value,
    passed: normalized.includes(value.toLocaleLowerCase('ru-RU')),
  }));
  return { passed: checks.every((check) => check.passed), checks };
}

export function responseWordCount(responseText) {
  return responseText.trim() ? responseText.trim().split(/\s+/u).length : 0;
}

export function summarizeEvaluation(runs) {
  const successfulRequests = runs.filter((run) => !run.error).length;
  const passedRuns = runs.filter((run) => run.passed).length;
  const retrievalChecks = runs.flatMap((run) => run.retrieval?.checks ?? []);
  const responseChecks = runs.flatMap((run) => run.response?.checks ?? []);
  const requiredChecks = responseChecks.filter((check) =>
    ['contains', 'contains-any'].includes(check.type),
  );
  const safetyChecks = responseChecks.filter((check) =>
    ['not-contains', 'not-matches'].includes(check.type),
  );
  const groundingChecks = runs.flatMap((run) => run.grounding?.checks ?? []);
  const latencies = runs
    .filter((run) => Number.isFinite(run.latencyMs))
    .map((run) => run.latencyMs);
  const wordCounts = runs
    .filter((run) => Number.isFinite(run.wordCount))
    .map((run) => run.wordCount);
  const attempts = runs.filter((run) => Number.isFinite(run.attempts)).map((run) => run.attempts);
  const averageLatencyMs = latencies.length
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : null;
  const correctnessRate = requiredChecks.length
    ? requiredChecks.filter((check) => check.passed).length / requiredChecks.length
    : 0;
  const safetyRate = safetyChecks.length
    ? safetyChecks.filter((check) => check.passed).length / safetyChecks.length
    : 0;
  const groundingRate = groundingChecks.length
    ? groundingChecks.filter((check) => check.passed).length / groundingChecks.length
    : 0;
  const averageWords = wordCounts.length
    ? Math.round(wordCounts.reduce((sum, value) => sum + value, 0) / wordCounts.length)
    : null;
  const qualityScore = 0.6 * correctnessRate + 0.25 * safetyRate + 0.15 * groundingRate;
  const lengthFactor = averageWords === null ? 0 : Math.min(1, 450 / Math.max(averageWords, 1));

  return {
    runs: runs.length,
    successfulRequests,
    passedRuns,
    passRate: runs.length ? passedRuns / runs.length : 0,
    retrievalRecall: retrievalChecks.length
      ? retrievalChecks.filter((check) => check.passed).length / retrievalChecks.length
      : 0,
    responseCheckRate: responseChecks.length
      ? responseChecks.filter((check) => check.passed).length / responseChecks.length
      : 0,
    correctnessRate,
    safetyRate,
    groundingRate,
    averageWords,
    averageAttempts: attempts.length
      ? Math.round((attempts.reduce((sum, value) => sum + value, 0) / attempts.length) * 10) / 10
      : null,
    qualityScore,
    optimalityScore: qualityScore * lengthFactor,
    averageLatencyMs,
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function percentage(value) {
  return Math.round(value * 1000) / 10 + '%';
}

function duration(value) {
  return value === null || value === undefined ? '—' : (value / 1000).toFixed(1) + ' s';
}

function checkMarkup(check) {
  const label = ['not-contains', 'not-matches'].includes(check.type)
    ? 'must omit'
    : check.type.replace('-', ' ');
  return `<li class="check ${check.passed ? 'pass' : 'fail'}"><span>${check.passed ? '✓' : '×'}</span><code>${escapeHtml(check.value)}</code><small>${escapeHtml(label)}</small></li>`;
}

function runMarkup(run) {
  const status = run.passed ? 'pass' : 'fail';
  const retrievalChecks = (run.retrieval?.checks ?? []).map(checkMarkup).join('');
  const responseChecks = (run.response?.checks ?? []).map(checkMarkup).join('');
  const groundingChecks = (run.grounding?.checks ?? []).map(checkMarkup).join('');
  const sources = (run.retrieval?.references ?? [])
    .map((source) => `<li><code>${escapeHtml(source)}</code></li>`)
    .join('');
  const answer = run.answer
    ? `<details><summary>Visible model answer</summary><pre>${escapeHtml(run.answer)}</pre></details>`
    : '';
  const error = run.error ? `<p class="error">${escapeHtml(run.error)}</p>` : '';

  return `<article class="run ${status}">
    <header><div><p class="eyebrow">${escapeHtml(run.category)} · run ${run.repeat}</p><h2>${escapeHtml(run.title)}</h2><code>${escapeHtml(run.taskId)}</code></div><span class="badge ${status}">${run.passed ? 'PASS' : 'FAIL'}</span></header>
    <div class="run-meta"><span>${duration(run.latencyMs)}</span><span>${run.attempts ?? 1} attempt(s)</span><span>${run.wordCount ?? 0} words</span><span>${run.retrieval?.bytes === null || run.retrieval?.bytes === undefined ? 'context size n/a' : run.retrieval.bytes + ' context bytes'}</span></div>
    ${error}
    <div class="columns">
      <section><h3>Retrieval</h3><ul class="checks">${retrievalChecks}</ul><h4>Selected references</h4><ul class="sources">${sources || '<li>None</li>'}</ul></section>
      <section><h3>Answer checks</h3><ul class="checks">${responseChecks || '<li class="muted">Not evaluated</li>'}</ul><h4>Source grounding</h4><ul class="checks">${groundingChecks || '<li class="muted">Not evaluated</li>'}</ul></section>
    </div>
    ${answer}
  </article>`;
}

export function renderEvaluationReport(report) {
  const summary = report.summary;
  const overallPass = summary.passedRuns === summary.runs && summary.runs > 0;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local model harness evaluation</title>
<style>
:root{color-scheme:dark;--bg:#0a0d12;--panel:#111722;--line:#293244;--text:#eef3fb;--muted:#97a4b8;--green:#54d6a2;--red:#ff7185;--amber:#f5c86a;--blue:#72a7ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% 0,#17233a 0,transparent 35%),var(--bg);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:56px 0 80px}.hero{display:grid;grid-template-columns:1.5fr 1fr;gap:24px;align-items:end;margin-bottom:28px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:var(--blue);font-size:12px;font-weight:700;margin:0 0 8px}h1{font-size:clamp(36px,6vw,68px);line-height:1;margin:0 0 18px;max-width:850px}h2{margin:2px 0 3px;font-size:23px}h3{margin:0 0 12px}h4{margin:22px 0 8px;color:var(--muted)}p{color:var(--muted)}.verdict{border:1px solid var(--line);border-radius:18px;padding:22px;background:color-mix(in srgb,var(--panel) 90%,transparent)}.verdict strong{display:block;font-size:32px;color:${overallPass ? 'var(--green)' : 'var(--red)'}}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px}.stat{border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:18px}.stat strong{font-size:28px;display:block}.stat span,.run-meta,small,.muted{color:var(--muted)}.metadata{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0}.metadata span{background:#151e2d;border:1px solid var(--line);border-radius:999px;padding:5px 10px}.run{border:1px solid var(--line);background:linear-gradient(145deg,#111722,#0d121b);border-radius:18px;padding:24px;margin:16px 0;box-shadow:0 18px 40px #0003}.run.pass{border-left:4px solid var(--green)}.run.fail{border-left:4px solid var(--red)}.run header{display:flex;justify-content:space-between;gap:16px}.badge{height:max-content;border-radius:999px;padding:6px 10px;font-weight:800;font-size:12px}.badge.pass{color:var(--green);background:#15362c}.badge.fail{color:var(--red);background:#3a1920}.run-meta{display:flex;gap:16px;margin:15px 0 20px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:26px;border-top:1px solid var(--line);padding-top:20px}.checks,.sources{list-style:none;padding:0;margin:0}.check{display:grid;grid-template-columns:22px 1fr auto;gap:8px;align-items:center;padding:7px 0}.check.pass span{color:var(--green)}.check.fail span{color:var(--red)}code{color:#cbd8ed;font:13px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}.sources li{overflow-wrap:anywhere;padding:3px 0}.error{color:var(--red);border:1px solid #572631;background:#2b151b;border-radius:10px;padding:12px}details{margin-top:20px;border-top:1px solid var(--line);padding-top:16px}summary{cursor:pointer;color:var(--blue);font-weight:700}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#090d13;border:1px solid var(--line);border-radius:12px;padding:16px;color:#dce7f7}.note{font-size:13px;margin-top:30px}@media(max-width:760px){.hero,.columns{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}.run header{align-items:flex-start}.check{grid-template-columns:22px 1fr}.check small{grid-column:2}}
</style></head><body><main>
<section class="hero"><div><p class="eyebrow">Provider-neutral benchmark</p><h1>Local model harness evaluation</h1><p>Frozen tasks measure skill retrieval and deterministic answer checks.</p></div><div class="verdict"><span>Overall result</span><strong>${overallPass ? 'PASS' : 'FAIL'}</strong><span>${summary.passedRuns} of ${summary.runs} runs passed</span></div></section>
<section class="stats"><div class="stat"><strong>${percentage(summary.passRate)}</strong><span>run pass rate</span></div><div class="stat"><strong>${percentage(summary.correctnessRate)}</strong><span>required facts</span></div><div class="stat"><strong>${percentage(summary.safetyRate)}</strong><span>safety checks</span></div><div class="stat"><strong>${percentage(summary.groundingRate)}</strong><span>source grounding</span></div><div class="stat"><strong>${summary.averageWords ?? '—'}</strong><span>average words</span></div><div class="stat"><strong>${duration(summary.averageLatencyMs)}</strong><span>average latency</span></div></section>
<section class="metadata"><span>provider: ${escapeHtml(report.metadata.provider ?? 'local')}</span><span>model: ${escapeHtml(report.metadata.model)}</span><span>commit: ${escapeHtml(report.metadata.commit)}${report.metadata.dirty ? ' (dirty)' : ''}</span><span>repeat: ${report.metadata.repeat}</span><span>repair attempts: ${report.metadata.repairAttempts ?? 0}</span><span>temperature: ${escapeHtml(report.metadata.temperature ?? 'provider default')}</span><span>reasoning: ${escapeHtml(report.metadata.reasoningEffort ?? 'provider default')}</span><span>generated: ${escapeHtml(report.metadata.generatedAt)}</span></section>
<section>${report.runs.map(runMarkup).join('\n')}</section>
<p class="note">The report intentionally excludes connection URLs, credentials, request prompts, system instructions, hidden reasoning, environment values, and project files.</p>
</main></body></html>`;
}
