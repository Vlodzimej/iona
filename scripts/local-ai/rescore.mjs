import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  evaluateGrounding,
  evaluateResponse,
  loadEvaluationTasks,
  renderEvaluationReport,
  responseWordCount,
  summarizeEvaluation,
} from './lib/evaluation.mjs';
import { normalizeSkillSourcePaths, projectRoot } from './lib/env.mjs';

function parseArguments(args) {
  const result = { input: null, output: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--input' || argument === '--output') {
      result[argument.slice(2)] = args[++index];
      if (!result[argument.slice(2)]) {
        throw new Error(argument + ' requires a path.');
      }
    } else {
      throw new Error('Unknown argument: ' + argument);
    }
  }
  if (!result.input || !result.output) {
    throw new Error('--input evaluation data and --output report path are required.');
  }
  return result;
}

function safeReportPath(path, extension) {
  const reportRoot = resolve(projectRoot, 'ai/reports');
  const target = resolve(projectRoot, path);
  const targetRelative = relative(reportRoot, target);
  if (
    targetRelative === '..' ||
    targetRelative.startsWith('..' + sep) ||
    targetRelative === '' ||
    !target.endsWith(extension)
  ) {
    throw new Error('Rescore paths must stay inside ai/reports and end with ' + extension + '.');
  }
  return target;
}

const parsed = parseArguments(process.argv.slice(2));
const original = JSON.parse(readFileSync(safeReportPath(parsed.input, '.json'), 'utf8'));
if (!Array.isArray(original?.runs) || !original?.metadata?.provider) {
  throw new Error('Input is not evaluation data.');
}
const tasks = new Map(
  loadEvaluationTasks(resolve(projectRoot, 'ai/evals/tasks')).map((task) => [task.id, task]),
);
const runs = original.runs.map((run) => {
  const task = tasks.get(run.taskId);
  if (!task || typeof run.answer !== 'string') {
    throw new Error('Cannot rescore task ' + run.taskId + '.');
  }
  const answer = normalizeSkillSourcePaths(run.answer);
  const response = evaluateResponse(task, answer);
  const grounding = evaluateGrounding(task, answer);
  return {
    ...run,
    answer,
    response,
    grounding,
    wordCount: responseWordCount(answer),
    passed: run.retrieval?.passed === true && response.passed && grounding.passed,
  };
});
const report = {
  metadata: {
    ...original.metadata,
    originalGeneratedAt: original.metadata.generatedAt,
    generatedAt: new Date().toISOString(),
    rescored: true,
  },
  summary: summarizeEvaluation(runs),
  runs,
};
const output = safeReportPath(parsed.output, '.html');
const dataOutput = output.replace(/\.html$/u, '.json');
writeFileSync(output, renderEvaluationReport(report), { encoding: 'utf8', mode: 0o600 });
writeFileSync(dataOutput, JSON.stringify(report, null, 2) + '\n', {
  encoding: 'utf8',
  mode: 0o600,
});
chmodSync(output, 0o600);
chmodSync(dataOutput, 0o600);
console.log('Rescored report: ' + output);
console.log('Rescored data: ' + dataOutput);
