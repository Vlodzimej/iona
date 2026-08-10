import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildContext } from '../../local-ai/lib/context.mjs';
import { chatCompletion, connectionConfig, resolveModel } from '../../local-ai/lib/client.mjs';
import { numberFromEnv, projectRoot } from '../../local-ai/lib/env.mjs';
import { loadAgentConfig } from './config.mjs';
import { agentToolDefinitions, completionMessage, toolRequests } from './protocol.mjs';
import { createAgentTools } from './tools.mjs';
import {
  appendRunEvent,
  applyWorktreePatch,
  createAgentWorktree,
  removeAgentWorktree,
  worktreePatch,
  worktreeStatus,
} from './worktree.mjs';

function publicAssistantMessage(message) {
  const result = { role: 'assistant', content: message.content ?? null };
  if (Array.isArray(message.tool_calls)) {
    result.tool_calls = message.tool_calls;
  }
  return result;
}

function toolResultMessage(request, result) {
  const content = JSON.stringify(result);
  return request.native
    ? { role: 'tool', tool_call_id: request.id, content }
    : {
        role: 'user',
        content: 'TOOL_RESULT for ' + request.name + '\n' + content + '\nChoose the next tool.',
      };
}

function resultForError(error) {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function maximumIterations(config, override) {
  if (override === undefined) {
    return config.maximumIterations;
  }
  if (!Number.isInteger(override) || override < 1 || override > 100) {
    throw new Error('--max-iterations must be an integer between 1 and 100.');
  }
  return override;
}

export async function runAgent(task, options = {}) {
  if (typeof task !== 'string' || !task.trim()) {
    throw new Error('Agent task must be a non-empty string.');
  }

  const agentConfig = loadAgentConfig(projectRoot);
  const iterations = maximumIterations(agentConfig, options.maximumIterations);
  const modelConfig = connectionConfig();
  const model = await resolveModel(modelConfig);
  const context = buildContext({
    query: task,
    maximumSkillBytes: numberFromEnv('LOCAL_AI_SKILL_MAX_BYTES', 6000, {
      minimum: 4000,
      maximum: 1000000,
    }),
  });
  const { projectReference: ignoredProjectReference, ...skillContext } = context;
  void ignoredProjectReference;
  const domainPrompt = readFileSync(resolve(projectRoot, 'ai/prompts/system.md'), 'utf8').trim();
  const agentPrompt = readFileSync(resolve(projectRoot, 'ai/prompts/agent.md'), 'utf8').trim();
  const systemPrompt =
    agentPrompt +
    '\n\nDOMAIN RULES\n' +
    domainPrompt +
    '\n\nBEGIN_TRUSTED_SKILL_CONTEXT\n' +
    JSON.stringify(skillContext) +
    '\nEND_TRUSTED_SKILL_CONTEXT';
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content:
        'TASK\n' +
        task.trim() +
        '\n\nStart by inspecting the repository with tools. Use finish only when the requested change is complete.',
    },
  ];
  let run;
  let runStarted = false;
  let totalToolCalls = 0;

  try {
    run = createAgentWorktree(projectRoot);
    const tools = createAgentTools({
      config: agentConfig,
      worktreeRoot: run.worktreeRoot,
      allowProtected: options.allowProtected === true,
      allowHostExecution:
        options.allowHostExecution === true || process.env.LOCAL_AGENT_ALLOW_HOST_EXECUTION === '1',
    });
    appendRunEvent(run.eventPath, {
      type: 'run_started',
      task: task.trim(),
      model,
      allowProtected: options.allowProtected === true,
      apply: options.apply === true,
    });
    runStarted = true;

    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const response = await chatCompletion(modelConfig, {
        model,
        messages,
        tools: agentToolDefinitions,
        tool_choice: 'auto',
        parallel_tool_calls: false,
        temperature: modelConfig.temperature,
        max_tokens: modelConfig.maximumTokens,
      });
      const message = completionMessage(response);
      const requests = toolRequests(message);
      appendRunEvent(run.eventPath, {
        type: 'model_response',
        iteration,
        content: message.content ?? null,
        tools: requests.map((request) => ({ name: request.name, arguments: request.arguments })),
      });

      if (requests.length === 0) {
        messages.push(publicAssistantMessage(message));
        messages.push({
          role: 'user',
          content:
            'A coding-agent response must call one of the available tools. Inspect, edit, validate, or call finish.',
        });
        continue;
      }

      messages.push(publicAssistantMessage(message));
      for (const request of requests) {
        totalToolCalls += 1;
        if (totalToolCalls > agentConfig.maximumToolCalls) {
          throw new Error('Maximum tool-call budget exceeded.');
        }

        let result;
        if (request.invalidArguments) {
          result = { ok: false, error: 'Invalid tool arguments: ' + request.invalidArguments };
        } else if (request.name === 'finish') {
          const summary = request.arguments?.summary;
          if (typeof summary !== 'string' || !summary.trim()) {
            result = { ok: false, error: 'finish.summary must be a non-empty string.' };
          } else {
            try {
              const status = worktreeStatus(run.worktreeRoot);
              if (!status) {
                result = { ok: true, noChanges: true };
              } else {
                result = tools.runChecks({ profile: agentConfig.requiredFinishCheck });
              }

              appendRunEvent(run.eventPath, {
                type: 'finish_validation',
                iteration,
                summary: summary.trim(),
                result,
              });

              if (result.ok) {
                const patch = worktreePatch(run.worktreeRoot);
                let applied = false;
                if (options.apply && patch) {
                  applied = applyWorktreePatch(projectRoot, run.worktreeRoot);
                }
                const completed = {
                  ok: true,
                  model,
                  runId: run.runId,
                  runRoot: run.runRoot,
                  worktreeRoot: run.worktreeRoot,
                  summary: summary.trim(),
                  status,
                  patch,
                  applied,
                  validation: result,
                };
                appendRunEvent(run.eventPath, { type: 'run_completed', applied, summary });
                return completed;
              }
            } catch (error) {
              result = resultForError(error);
            }
          }
        } else {
          try {
            result = tools.execute(request.name, request.arguments);
          } catch (error) {
            result = resultForError(error);
          }
        }

        appendRunEvent(run.eventPath, {
          type: 'tool_result',
          iteration,
          tool: request.name,
          result,
        });
        messages.push(toolResultMessage(request, result));
      }
    }
    throw new Error('Maximum agent iterations exceeded without a successful finish.');
  } catch (error) {
    if (run) {
      try {
        appendRunEvent(run.eventPath, { type: 'run_failed', error: resultForError(error).error });
      } catch {
        // Preserve the original runtime error.
      }
      error.agentRun = { ...run, worktreeRetained: runStarted };
      if (!runStarted) {
        try {
          removeAgentWorktree(projectRoot, run.worktreeRoot);
        } catch {
          error.agentRun.worktreeRetained = true;
        }
      }
    }
    throw error;
  }
}
