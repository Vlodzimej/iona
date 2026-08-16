import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { chatCompletion, connectionConfig, messageText, resolveModel } from './lib/client.mjs';
import {
  loadEvaluationTasks,
  evaluateGrounding,
  evaluateResponse,
  evaluateRetrieval,
  renderEvaluationReport,
  responseWordCount,
  summarizeEvaluation,
} from './lib/evaluation.mjs';
import { normalizeSkillSourcePaths, projectRoot, skillSourceRoot } from './lib/env.mjs';
import { createReadOnlyRequest } from './lib/read-only-request.mjs';

function parseArguments(args) {
  const result = {
    taskIds: [],
    repeat: 1,
    output: null,
    provider: 'local',
    repairAttempts: 1,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--task') {
      result.taskIds.push(args[++index]);
    } else if (argument === '--repeat') {
      result.repeat = Number(args[++index]);
    } else if (argument === '--output') {
      result.output = args[++index];
      if (!result.output) {
        throw new Error('--output requires a report path.');
      }
    } else if (argument === '--provider') {
      result.provider = args[++index];
      if (!['local', 'codex'].includes(result.provider)) {
        throw new Error('--provider must be local or codex.');
      }
    } else if (argument === '--repair-attempts') {
      result.repairAttempts = Number(args[++index]);
    } else {
      throw new Error('Unknown argument: ' + argument);
    }
  }
  if (result.taskIds.some((id) => !id)) {
    throw new Error('--task requires an evaluation task id.');
  }
  if (!Number.isInteger(result.repeat) || result.repeat < 1 || result.repeat > 10) {
    throw new Error('--repeat must be an integer from 1 to 10.');
  }
  if (
    !Number.isInteger(result.repairAttempts) ||
    result.repairAttempts < 0 ||
    result.repairAttempts > 2
  ) {
    throw new Error('--repair-attempts must be an integer from 0 to 2.');
  }
  return result;
}

function repairPrompt(responseEvaluation, grounding) {
  const failures = [...responseEvaluation.checks, ...grounding.checks].filter(
    (check) => !check.passed,
  );
  return (
    'Revise the complete answer once. Preserve correct content and fix every failed deterministic constraint:\n' +
    failures
      .map((check) => {
        if (['not-contains', 'not-matches'].includes(check.type)) {
          return '- Remove the unsupported claim or token: ' + check.value;
        }
        if (check.type === 'cited-reference') {
          return '- Cite the used allowlisted source: ' + check.value;
        }
        return '- Include the required concept or wording: ' + check.value;
      })
      .join('\n') +
    '\nReturn only the full revised answer. Keep it under 450 words and do not discuss the validator.'
  );
}

function codexPrompt(task) {
  return (
    task.prompt +
    '\n\nBENCHMARK CONTRACT\n' +
    '- This is read-only: do not inspect or modify project application files.\n' +
    '- Load only task-relevant guidance from ' +
    skillSourceRoot +
    '/angular-developer and ' +
    skillSourceRoot +
    '/capacitor-plugins.\n' +
    '- Prefer a correct, compact answer under 450 words. Do not guess exact versions.\n' +
    '- For native plugins, name APIs, permissions, configuration, and platform behavior only when supported by the skill excerpt; otherwise require checking package documentation.\n' +
    '- End with `Skill sources` and list only skill paths actually used.'
  );
}

function codexCompletion(task) {
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'harness-codex-eval-'));
  const answerPath = resolve(temporaryDirectory, 'answer.txt');
  try {
    const result = spawnSync(
      'codex',
      [
        'exec',
        '--ephemeral',
        '--sandbox',
        'read-only',
        '--cd',
        projectRoot,
        '--output-last-message',
        answerPath,
        '--color',
        'never',
        codexPrompt(task),
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: (task.timeoutSeconds ?? 120) * 1000,
      },
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error('Codex CLI exited with status ' + result.status + '.');
    }
    return readFileSync(answerPath, 'utf8').trim();
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function citedRetrieval(task, answer) {
  const references = (task.expectedReferences ?? []).filter((source) => answer.includes(source));
  const skills = task.expectedSkills.filter((skill) => answer.includes(skill + '/SKILL.md'));
  const checks = [
    ...task.expectedSkills.map((value) => ({
      type: 'cited-skill',
      value,
      passed: skills.includes(value),
    })),
    ...(task.expectedReferences ?? []).map((value) => ({
      type: 'cited-reference',
      value,
      passed: references.includes(value),
    })),
  ];
  return { passed: checks.every((check) => check.passed), checks, skills, references, bytes: null };
}

function codexVersion() {
  const result = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error('Codex CLI is required for --provider codex.');
  }
  return result.stdout.trim();
}

function gitValue(args, fallback) {
  try {
    return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function reportPath(requestedPath) {
  const reportRoot = resolve(projectRoot, 'ai/reports');
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const output = resolve(
    projectRoot,
    requestedPath ?? 'ai/reports/local-model-eval-' + stamp + '.html',
  );
  const outputRelative = relative(reportRoot, output);
  if (
    outputRelative === '..' ||
    outputRelative.startsWith('..' + sep) ||
    outputRelative === '' ||
    !output.endsWith('.html')
  ) {
    throw new Error('Evaluation reports must use an .html path inside ai/reports.');
  }
  return output;
}

const parsed = parseArguments(process.argv.slice(2));
const tasks = loadEvaluationTasks(resolve(projectRoot, 'ai/evals/tasks'), parsed.taskIds);
const output = reportPath(parsed.output);
const config = parsed.provider === 'local' ? connectionConfig() : null;
const model = parsed.provider === 'local' ? await resolveModel(config) : codexVersion();
const runs = [];

for (let repeat = 1; repeat <= parsed.repeat; repeat += 1) {
  for (const task of tasks) {
    process.stderr.write(
      '[' + (runs.length + 1) + '/' + tasks.length * parsed.repeat + '] ' + task.id + '\n',
    );
    let retrieval;
    const startedAt = performance.now();
    try {
      let answer;
      let responseEvaluation;
      let grounding;
      let attempts = 1;
      if (parsed.provider === 'local') {
        const prepared = createReadOnlyRequest(task.prompt);
        retrieval = evaluateRetrieval(task, prepared.context);
        const timeoutMs = Math.min(config.timeoutMs, (task.timeoutSeconds ?? 120) * 1000);
        let messages = prepared.messages;
        for (let repair = 0; repair <= parsed.repairAttempts; repair += 1) {
          attempts = repair + 1;
          const response = await chatCompletion(
            { ...config, timeoutMs },
            {
              model,
              messages,
              temperature: config.temperature,
              max_tokens: config.maximumTokens,
            },
          );
          answer = normalizeSkillSourcePaths(messageText(response));
          responseEvaluation = evaluateResponse(task, answer);
          grounding = evaluateGrounding(task, answer);
          if (responseEvaluation.passed && grounding.passed) {
            break;
          }
          messages = [
            ...messages,
            { role: 'assistant', content: answer },
            { role: 'user', content: repairPrompt(responseEvaluation, grounding) },
          ];
        }
      } else {
        answer = normalizeSkillSourcePaths(codexCompletion(task));
        retrieval = citedRetrieval(task, answer);
        responseEvaluation = evaluateResponse(task, answer);
        grounding = evaluateGrounding(task, answer);
      }
      runs.push({
        taskId: task.id,
        title: task.title,
        category: task.category,
        repeat,
        attempts,
        latencyMs: Math.round(performance.now() - startedAt),
        retrieval,
        response: responseEvaluation,
        grounding,
        wordCount: responseWordCount(answer),
        answer,
        passed: retrieval.passed && responseEvaluation.passed && grounding.passed,
      });
    } catch (error) {
      runs.push({
        taskId: task.id,
        title: task.title,
        category: task.category,
        repeat,
        latencyMs: Math.round(performance.now() - startedAt),
        retrieval,
        response: null,
        answer: null,
        error: error instanceof Error ? error.message : String(error),
        passed: false,
      });
    }
  }
}

const summary = summarizeEvaluation(runs);
const report = {
  metadata: {
    model,
    provider: parsed.provider,
    commit: gitValue(['rev-parse', '--short', 'HEAD'], 'unknown'),
    dirty: Boolean(gitValue(['status', '--porcelain'], '')),
    repeat: parsed.repeat,
    repairAttempts: parsed.provider === 'local' ? parsed.repairAttempts : 0,
    temperature: config?.temperature ?? null,
    reasoningEffort: config?.reasoningEffort ?? null,
    generatedAt: new Date().toISOString(),
  },
  summary,
  runs,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, renderEvaluationReport(report), { encoding: 'utf8', mode: 0o600 });
chmodSync(output, 0o600);
const dataOutput = output.replace(/\.html$/u, '.json');
writeFileSync(dataOutput, JSON.stringify(report, null, 2) + '\n', {
  encoding: 'utf8',
  mode: 0o600,
});
chmodSync(dataOutput, 0o600);

console.log('Report: ' + output);
console.log('Data: ' + dataOutput);
console.log(
  'Result: ' +
    summary.passedRuns +
    '/' +
    summary.runs +
    ' passed; retrieval ' +
    Math.round(summary.retrievalRecall * 1000) / 10 +
    '%; answer checks ' +
    Math.round(summary.responseCheckRate * 1000) / 10 +
    '%.',
);
if (summary.passedRuns !== summary.runs) {
  process.exitCode = 1;
}
