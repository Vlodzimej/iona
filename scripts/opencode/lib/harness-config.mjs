import { resolve } from 'node:path';

export function parseHarnessLauncherArguments(args, defaultRepository) {
  const forwarded = [];
  let repositoryPath = defaultRepository;
  let profile = 'angular-ionic-capacitor';
  let stateRoot;
  let visual = false;
  let timeoutSeconds;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (['--repo', '--profile', '--state-root', '--timeout-seconds'].includes(argument)) {
      const value = args[index + 1];
      if (!value) {
        throw new Error(argument + ' requires a value.');
      }
      if (argument === '--repo') repositoryPath = value;
      if (argument === '--profile') profile = value;
      if (argument === '--state-root') stateRoot = value;
      if (argument === '--timeout-seconds') {
        timeoutSeconds = Number(value);
        if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 14_400) {
          throw new Error('--timeout-seconds must be an integer from 30 to 14400.');
        }
      }
      index += 1;
    } else if (argument === '--visual') {
      visual = true;
    } else {
      forwarded.push(argument);
    }
  }
  return { forwarded, repositoryPath, profile, stateRoot, timeoutSeconds, visual };
}

export function openCodeRunOutcomeError(forwarded, previousRunIds, currentRuns) {
  if (forwarded[0] !== 'run') return null;
  const previous = new Set(previousRunIds);
  const created = currentRuns.filter((run) => !previous.has(run.runId));
  if (created.length !== 1) {
    return 'OpenCode run did not create exactly one controlled harness run.';
  }
  if (!['ready', 'waiting_approval'].includes(created[0].status)) {
    return (
      'OpenCode exited before harness run ' +
      created[0].runId +
      ' reached ready or waiting_approval status (current: ' +
      created[0].status +
      ').'
    );
  }
  return null;
}

export function createEnforcedOpenCodeConfig({
  harnessRoot,
  nodeExecutable,
  repositoryId,
  profile,
  stateRoot,
  visual = false,
}) {
  const config = {
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
            options: { reasoningEffort: 'low', temperature: 0.1 },
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
  if (visual) {
    config.instructions.push(resolve(harnessRoot, 'ai/prompts/opencode-visual.md'));
    config.permission['ionic_visual_*'] = 'allow';
    config.mcp.ionic_visual = {
      type: 'local',
      command: [nodeExecutable, resolve(harnessRoot, 'scripts/harness/visual-mcp.mjs')],
      enabled: true,
      timeout: 20_000,
      environment: {
        IONIC_HARNESS_REPOSITORY_ID: repositoryId,
        IONIC_HARNESS_STATE_ROOT: stateRoot,
      },
    };
  }
  return config;
}
