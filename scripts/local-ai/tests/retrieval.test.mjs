import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildContext } from '../lib/context.mjs';
import {
  evaluateRetrieval,
  loadEvaluationTasks,
  validateEvaluationTask,
} from '../lib/evaluation.mjs';
import { projectRoot } from '../lib/env.mjs';

test('all frozen tasks satisfy the evaluation contract and retrieval expectations', async (context) => {
  const tasks = loadEvaluationTasks(resolve(projectRoot, 'ai/evals/tasks'));
  assert.equal(tasks.length, 12);
  assert.deepEqual(tasks.map((task) => task.id).sort(), [
    'angular-route-guard-security',
    'angular-signal-forms',
    'angular-signals-http',
    'angular-vitest-signals',
    'capacitor-filesystem-transfer',
    'capacitor-network-offline',
    'capacitor-plugin-selection',
    'ionic-deep-links-routing',
    'ionic-native-share-haptics',
    'practical-angular-accessible-state',
    'practical-camera-minimal-permissions',
    'practical-plugin-api-evidence',
  ]);

  for (const task of tasks) {
    await context.test(task.id, () => {
      validateEvaluationTask(task, task.id);
      const retrieval = evaluateRetrieval(
        task,
        buildContext({ query: task.prompt, maximumSkillBytes: 7200 }),
      );
      assert.equal(
        retrieval.passed,
        true,
        retrieval.checks
          .filter((check) => !check.passed)
          .map((check) => check.type + ': ' + check.value)
          .join(', '),
      );
    });
  }
});
