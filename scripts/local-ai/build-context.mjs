import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { buildContext } from './lib/context.mjs';
import { loadLocalAiEnv, numberFromEnv, projectRoot } from './lib/env.mjs';

function parseArguments(args) {
  const queryParts = [];
  let includeProjectReference = false;
  let output;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const nextValue = args[index + 1];

    if (argument === '--query') {
      queryParts.push(nextValue ?? '');
      index += 1;
    } else if (argument === '--output') {
      output = nextValue;
      index += 1;
    } else if (argument === '--with-project-reference') {
      includeProjectReference = true;
    } else {
      queryParts.push(argument);
    }
  }

  return { query: queryParts.join(' ').trim(), includeProjectReference, output };
}

loadLocalAiEnv();

const parsed = parseArguments(process.argv.slice(2));
if (!parsed.query) {
  console.error(
    'Usage: npm run ai:context -- --query "task" [--with-project-reference] [--output ai/generated/context.json]',
  );
  process.exit(2);
}

const context = buildContext({
  query: parsed.query,
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
const serialized = JSON.stringify(context, null, 2) + '\n';

if (parsed.output) {
  const outputPath = resolve(projectRoot, parsed.output);
  const allowedOutputRoot = resolve(projectRoot, 'ai/generated');
  const relativeOutput = relative(allowedOutputRoot, outputPath);

  if (relativeOutput.startsWith('..') || relativeOutput === '') {
    throw new Error('Context output must be a file inside ai/generated.');
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, 'utf8');
  console.log('Context written to ' + relative(projectRoot, outputPath));
} else {
  process.stdout.write(serialized);
}
