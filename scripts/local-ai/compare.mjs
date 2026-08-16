import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { renderComparisonReport } from './lib/comparison.mjs';
import { projectRoot } from './lib/env.mjs';

function parseArguments(args) {
  const result = { local: null, codex: null, output: 'ai/reports/model-comparison.html' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--local' || argument === '--codex' || argument === '--output') {
      result[argument.slice(2)] = args[++index];
      if (!result[argument.slice(2)]) {
        throw new Error(argument + ' requires a path.');
      }
    } else {
      throw new Error('Unknown argument: ' + argument);
    }
  }
  if (!result.local || !result.codex) {
    throw new Error('--local and --codex evaluation data are required.');
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
    throw new Error('Comparison paths must stay inside ai/reports and end with ' + extension + '.');
  }
  return target;
}

function readEvaluation(path, provider) {
  const report = JSON.parse(readFileSync(safeReportPath(path, '.json'), 'utf8'));
  if (report?.metadata?.provider !== provider || !Array.isArray(report?.runs)) {
    throw new Error(path + ' is not ' + provider + ' evaluation data.');
  }
  return report;
}

const parsed = parseArguments(process.argv.slice(2));
const comparison = {
  local: readEvaluation(parsed.local, 'local'),
  codex: readEvaluation(parsed.codex, 'codex'),
};
const output = safeReportPath(parsed.output, '.html');
writeFileSync(output, renderComparisonReport(comparison), { encoding: 'utf8', mode: 0o600 });
chmodSync(output, 0o600);
console.log('Comparison report: ' + output);
