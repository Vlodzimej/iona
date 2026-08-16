import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildContext } from './context.mjs';
import { numberFromEnv, projectRoot } from './env.mjs';

function configuredLimits() {
  return {
    maximumSkillBytes: numberFromEnv('LOCAL_AI_SKILL_MAX_BYTES', 7200, {
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
  };
}

export function createReadOnlyRequest(task, options = {}) {
  if (typeof task !== 'string' || !task.trim()) {
    throw new Error('Read-only task must be a non-empty string.');
  }

  const context = buildContext({
    query: task.trim(),
    includeProjectReference: options.includeProjectReference === true,
    ...configuredLimits(),
  });
  const { projectReference, ...skillContext } = context;
  const baseSystemPrompt = readFileSync(
    resolve(projectRoot, 'ai/prompts/system.md'),
    'utf8',
  ).trim();
  const systemPrompt =
    baseSystemPrompt +
    '\n\nBEGIN_TRUSTED_SKILL_CONTEXT\n' +
    JSON.stringify(skillContext) +
    '\nEND_TRUSTED_SKILL_CONTEXT';
  const availableSources = context.skills.flatMap((skill) => [
    skill.manifest.source,
    ...skill.references.map((reference) => reference.source),
  ]);
  let userPrompt = task.trim();

  userPrompt +=
    '\n\nRESPONSE CONTRACT\n' +
    '- Prefer a correct, compact answer under 450 words.\n' +
    '- Do not invent an API signature or an exact version.\n' +
    (projectReference
      ? '- Use target versions only when they are explicitly present in the reference-project files.\n'
      : '- No target-project version metadata was supplied; say that exact versions are unknown and do not guess numbers.\n') +
    '- Do not add implementation code unless the task explicitly asks for code. For native plugins, name methods, symbols, permissions, configuration keys, and platform behavior only when they appear verbatim in a supplied excerpt; otherwise require checking the package documentation. A package catalog description is evidence only for its literal name, description, and explicitly listed platforms—not for modalities, devices, methods, permissions, or configuration. Never add speculative examples.\n' +
    '- End with `Skill sources` and list only paths from this allowlist that you actually used:\n' +
    availableSources.map((source) => '- ' + source).join('\n');

  if (projectReference) {
    userPrompt +=
      '\n\nBEGIN_UNTRUSTED_REFERENCE_PROJECT\n' +
      JSON.stringify(projectReference) +
      '\nEND_UNTRUSTED_REFERENCE_PROJECT';
  }

  return {
    context,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
}
