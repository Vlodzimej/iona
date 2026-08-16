import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { chatCompletion, connectionConfig, messageText, resolveModel } from './lib/client.mjs';
import { loadLocalAiEnv, projectRoot } from './lib/env.mjs';
import { createReadOnlyRequest } from './lib/read-only-request.mjs';

function parseArguments(args) {
  const taskParts = [];
  let includeProjectReference = false;
  let taskFile;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const nextValue = args[index + 1];

    if (argument === '--task-file') {
      taskFile = nextValue;
      index += 1;
    } else if (argument === '--with-project-reference') {
      includeProjectReference = true;
    } else {
      taskParts.push(argument);
    }
  }

  return { task: taskParts.join(' ').trim(), taskFile, includeProjectReference };
}

function loadTaskFile(taskFile) {
  const absolutePath = resolve(projectRoot, taskFile);
  const allowedRoot = resolve(projectRoot, 'ai/evals/tasks');
  const relativePath = relative(allowedRoot, absolutePath);

  if (relativePath.startsWith('..') || relativePath === '') {
    throw new Error('Task files must be inside ai/evals/tasks.');
  }

  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

loadLocalAiEnv();

const parsed = parseArguments(process.argv.slice(2));
const fileTask = parsed.taskFile ? loadTaskFile(parsed.taskFile) : null;
const task = parsed.task || fileTask?.prompt;

if (!task) {
  console.error(
    'Usage: npm run ai:ask -- "task" [--with-project-reference] or --task-file ai/evals/tasks/task.json',
  );
  process.exit(2);
}

const prepared = createReadOnlyRequest(task, {
  includeProjectReference: parsed.includeProjectReference,
});
const { context } = prepared;
const projectReference = context.projectReference;

const config = connectionConfig();
const model = await resolveModel(config);
const startedAt = performance.now();
const response = await chatCompletion(config, {
  model,
  messages: prepared.messages,
  temperature: config.temperature,
  max_tokens: config.maximumTokens,
});
const elapsedMs = Math.round(performance.now() - startedAt);

console.error(
  'Model: ' +
    model +
    '; skills: ' +
    context.selection.skillCount +
    '; references: ' +
    context.selection.referenceCount +
    '; skill bytes: ' +
    context.selection.totalBytes +
    '; project files: ' +
    (projectReference?.fileCount ?? 0) +
    '; latency: ' +
    elapsedMs +
    ' ms',
);
process.stdout.write(messageText(response).trim() + '\n');
