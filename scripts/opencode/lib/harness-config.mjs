import { resolve } from 'node:path';

export function parseHarnessLauncherArguments(args, defaultRepository) {
  const forwarded = [];
  let repositoryPath = defaultRepository;
  let profile = 'angular-ionic-capacitor';
  let stateRoot;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (['--repo', '--profile', '--state-root'].includes(argument)) {
      const value = args[index + 1];
      if (!value) {
        throw new Error(argument + ' requires a value.');
      }
      if (argument === '--repo') repositoryPath = value;
      if (argument === '--profile') profile = value;
      if (argument === '--state-root') stateRoot = value;
      index += 1;
    } else {
      forwarded.push(argument);
    }
  }
  return { forwarded, repositoryPath, profile, stateRoot };
}

export function createEnforcedOpenCodeConfig({
  harnessRoot,
  nodeExecutable,
  repositoryId,
  profile,
  stateRoot,
}) {
  return {
    $schema: 'https://opencode.ai/config.json',
    model: 'lmstudio/gpt-oss-20b',
    small_model: 'lmstudio/gpt-oss-20b',
    enabled_providers: ['lmstudio'],
    provider: {
      lmstudio: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Remote LM Studio',
        options: {
          baseURL: '{env:LOCAL_AI_BASE_URL}',
          apiKey: '{env:LOCAL_AI_API_KEY}',
        },
        models: {
          'gpt-oss-20b': {
            name: 'gpt-oss-20b',
            limit: { context: 32768, output: 4096 },
          },
        },
      },
    },
    instructions: [resolve(harnessRoot, 'ai/prompts/opencode-harness.md')],
    permission: {
      '*': 'deny',
      skill: 'allow',
      question: 'allow',
      todowrite: 'allow',
      doom_loop: 'ask',
      'ionic_harness_*': 'allow',
    },
    mcp: {
      ionic_harness: {
        type: 'local',
        command: [nodeExecutable, resolve(harnessRoot, 'scripts/harness/mcp.mjs')],
        enabled: true,
        timeout: 15_000,
        environment: {
          IONIC_HARNESS_REPOSITORY_ID: repositoryId,
          IONIC_HARNESS_PROFILE: profile,
          IONIC_HARNESS_STATE_ROOT: stateRoot,
        },
      },
    },
    watcher: { ignore: ['**'] },
  };
}
