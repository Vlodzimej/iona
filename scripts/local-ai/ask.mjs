import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { buildContext } from './lib/context.mjs';
import { chatCompletion, connectionConfig, messageText, resolveModel } from './lib/client.mjs';
import { loadLocalAiEnv, numberFromEnv, projectRoot } from './lib/env.mjs';

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

const context = buildContext({
  query: task,
  includeProjectReference: parsed.includeProjectReference,
  maximumSkillBytes: numberFromEnv('LOCAL_AI_SKILL_MAX_BYTES', 6000, {
    minimum: 4000,
    maximum: 1000000,
  }),
  maximumProjectFiles: numberFromEnv('LOCAL_AI_PROJECT_MAX_FILES', 8, {
    minimum: 1,
    maximum: 50,
  }),
  maximumProjectBytes: numberFromEnv('LOCAL_AI_PROJECT_MAX_BYTES', 100000, {
    minimum: 1000,
    maximum: 1000000,
  }),
});
const { projectReference, ...skillContext } = context;
const baseSystemPrompt = readFileSync(resolve(projectRoot, 'ai/prompts/system.md'), 'utf8').trim();
const systemPrompt =
  baseSystemPrompt +
  '\n\nBEGIN_TRUSTED_SKILL_CONTEXT\n' +
  JSON.stringify(skillContext) +
  '\nEND_TRUSTED_SKILL_CONTEXT';
let userPrompt = task;
const availableSources = context.skills.flatMap((skill) => [
  skill.manifest.source,
  ...skill.references.map((reference) => reference.source),
]);

userPrompt +=
  '\n\nRESPONSE CONTRACT\n' +
  '- Prefer a correct, compact answer under 450 words.\n' +
  '- Do not invent an API signature or an exact version.\n' +
  (projectReference
    ? '- Use target versions only when they are explicitly present in the reference-project files.\n'
    : '- No target-project version metadata was supplied; say that exact versions are unknown and do not guess numbers.\n') +
  '- Do not add implementation code unless the task explicitly asks for code. For plugin code, every imported symbol and method must appear verbatim in a supplied excerpt; otherwise require checking the package documentation.\n' +
  '- End with `Skill sources` and list only paths from this allowlist that you actually used:\n' +
  availableSources.map((source) => '- ' + source).join('\n');

if (projectReference) {
  userPrompt +=
    '\n\nBEGIN_UNTRUSTED_REFERENCE_PROJECT\n' +
    JSON.stringify(projectReference) +
    '\nEND_UNTRUSTED_REFERENCE_PROJECT';
}

const config = connectionConfig();
const model = await resolveModel(config);
const startedAt = performance.now();
const response = await chatCompletion(config, {
  model,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ],
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
