import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { renderComparisonReport } from '../lib/comparison.mjs';
import {
  evaluateResponse,
  renderEvaluationReport,
  summarizeEvaluation,
  validateEvaluationTask,
} from '../lib/evaluation.mjs';
import { projectRoot } from '../lib/env.mjs';

const task = {
  id: 'sample-task',
  title: 'Sample evaluation',
  category: 'testing',
  prompt: 'Explain this sample task safely.',
  readOnly: true,
  expectedSkills: ['angular-developer'],
  expectedReferences: ['angular-developer/references/testing-fundamentals.md'],
  checks: [
    { type: 'contains', values: ['Vitest'] },
    { type: 'not-contains', values: ['Jasmine'] },
  ],
};

test('evaluation task validation enforces read-only frozen tasks', () => {
  assert.equal(validateEvaluationTask(task), task);
  assert.throws(() => validateEvaluationTask({ ...task, readOnly: false }), /readOnly/u);
  assert.throws(() => validateEvaluationTask({ ...task, secret: true }), /unknown properties/u);
});

test('response checks are case-insensitive and report each assertion', () => {
  const result = evaluateResponse(task, 'Use VITEST for this test.');
  assert.equal(result.passed, true);
  assert.deepEqual(
    result.checks.map((check) => check.passed),
    [true, true],
  );
});

test('contains-any accepts one semantic wording without rewarding every alternative', () => {
  const result = evaluateResponse(
    {
      ...task,
      checks: [{ type: 'contains-any', values: ['documentation', 'документац'] }],
    },
    'Проверьте документацию пакета.',
  );
  assert.equal(result.passed, true);
  assert.equal(result.checks.length, 1);
});

test('not-matches rejects invalid Angular attribute-style control flow', () => {
  const regexTask = {
    ...task,
    checks: [{ type: 'not-matches', values: ['<[a-z][^>]*\\s@if\\b'] }],
  };
  assert.equal(evaluateResponse(regexTask, '@if (ready()) { <p>Ready</p> }').passed, true);
  assert.equal(evaluateResponse(regexTask, '<div @if="ready()">Ready</div>').passed, false);
  assert.throws(
    () => validateEvaluationTask({ ...task, checks: [{ type: 'not-matches', values: ['['] }] }),
    /invalid regex/u,
  );
});

test('summary and standalone report escape all model-controlled text', () => {
  const runs = [
    {
      taskId: task.id,
      title: task.title,
      category: task.category,
      repeat: 1,
      latencyMs: 1250,
      retrieval: {
        passed: true,
        bytes: 512,
        references: ['angular-developer/references/testing-fundamentals.md'],
        checks: [{ type: 'expected-reference', value: '<script>alert(1)</script>', passed: true }],
      },
      response: { passed: true, checks: [{ type: 'contains', value: 'Vitest', passed: true }] },
      grounding: {
        passed: true,
        checks: [
          {
            type: 'cited-reference',
            value: 'angular-developer/references/testing-fundamentals.md',
            passed: true,
          },
        ],
      },
      wordCount: 4,
      answer: '<script>alert(1)</script>',
      passed: true,
    },
  ];
  const summary = summarizeEvaluation(runs);
  assert.equal(summary.passRate, 1);
  assert.equal(summary.averageLatencyMs, 1250);
  assert.equal(summary.groundingRate, 1);

  const html = renderEvaluationReport({
    metadata: {
      model: 'local-model',
      commit: 'abc1234',
      dirty: false,
      repeat: 1,
      temperature: 0.1,
      reasoningEffort: 'low',
      generatedAt: '2026-08-15T00:00:00.000Z',
    },
    summary,
    runs,
  });
  assert.match(html, /<!doctype html>/u);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /\.verdict strong\{[^}]+\}\.stats\{/u);
  assert.doesNotMatch(html, new RegExp(task.prompt, 'u'));
});

test('comparison report shows both providers and escapes task identifiers', () => {
  const base = {
    metadata: { provider: 'local', model: 'gpt-oss-20b' },
    summary: {
      passRate: 1,
      correctnessRate: 1,
      safetyRate: 1,
      groundingRate: 1,
      optimalityScore: 1,
      qualityScore: 1,
      averageWords: 4,
      averageLatencyMs: 1000,
    },
    runs: [
      {
        taskId: '<unsafe>',
        passed: true,
        latencyMs: 1000,
        wordCount: 4,
        response: {
          checks: [
            { type: 'contains', passed: true },
            { type: 'not-contains', passed: true },
          ],
        },
        grounding: { checks: [{ passed: true }] },
      },
    ],
  };
  const html = renderComparisonReport({
    local: base,
    codex: {
      ...base,
      metadata: { provider: 'codex', model: 'codex-cli' },
    },
  });
  assert.match(html, /gpt-oss-20b vs Codex/u);
  assert.match(html, /&lt;unsafe&gt;/u);
  assert.doesNotMatch(html, /<unsafe>/u);
});

test('evaluation CLI rejects an output flag without a path before contacting the model', () => {
  const result = spawnSync(
    process.execPath,
    [resolve(projectRoot, 'scripts/local-ai/evaluate.mjs'), '--output'],
    { cwd: projectRoot, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--output requires a report path/u);
});
