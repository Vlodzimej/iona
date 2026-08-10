import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildContext } from '../../local-ai/lib/context.mjs';
import { chatCompletion, connectionConfig, resolveModel } from '../../local-ai/lib/client.mjs';
import { loadLocalAiEnv, numberFromEnv, projectRoot } from '../../local-ai/lib/env.mjs';
import { createApproval, loadApproval, ApprovalRequiredError } from './approval.mjs';
import { loadAgentConfig } from './config.mjs';
import { createExecutor, selectedExecutor } from './executor.mjs';
import { agentToolDefinitions, completionMessage, toolRequests } from './protocol.mjs';
import { loadRunState, publicRunState, saveRunState } from './state.mjs';
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

function publicApproval(approval) {
  return {
    id: approval.id,
    status: approval.status,
    capability: approval.capability,
    paths: approval.paths,
    reason: approval.reason,
    createdAt: approval.createdAt,
    expiresAt: approval.expiresAt,
    decidedAt: approval.decidedAt,
    actor: approval.actor,
  };
}

function waitingResult(state) {
  return {
    ok: false,
    status: 'waiting_approval',
    runId: state.runId,
    runRoot: state.runRoot,
    worktreeRoot: state.worktreeRoot,
    approval: state.approval,
  };
}

function toolContext(config, state, approvalGrant) {
  return {
    config,
    projectRoot,
    worktreeRoot: state.worktreeRoot,
    allowProtected: state.options.allowProtected === true,
    allowHostExecution:
      state.options.allowHostExecution === true ||
      process.env.LOCAL_AGENT_ALLOW_HOST_EXECUTION === '1',
    type: state.executor,
    runId: state.runId,
    approvalGrant,
  };
}

function runtimeTools(config, state, approvalGrant) {
  const context = toolContext(config, state, approvalGrant);
  return createAgentTools({ ...context, executor: createExecutor(context) });
}

function finishRun(config, state, tools, request, iteration) {
  const summary = request.arguments?.summary;
  let result;
  if (typeof summary !== 'string' || !summary.trim()) {
    return { completed: false, result: { ok: false, error: 'finish.summary must be non-empty.' } };
  }

  try {
    const status = worktreeStatus(state.worktreeRoot);
    result = status
      ? tools.runChecks({ profile: config.requiredFinishCheck })
      : { ok: true, noChanges: true };
    appendRunEvent(state.eventPath, {
      type: 'finish_validation',
      iteration,
      summary: summary.trim(),
      result,
    });
    if (!result.ok) {
      return { completed: false, result };
    }

    const patch = worktreePatch(state.worktreeRoot);
    let applied = false;
    if (state.options.apply && patch) {
      applied = applyWorktreePatch(projectRoot, state.worktreeRoot);
    }
    const completed = {
      ok: true,
      status: 'completed',
      model: state.model,
      runId: state.runId,
      runRoot: state.runRoot,
      worktreeRoot: state.worktreeRoot,
      summary: summary.trim(),
      statusText: status,
      patch,
      applied,
      validation: result,
    };
    state.status = 'completed';
    state.result = completed;
    state.approval = null;
    state.pendingRequest = null;
    saveRunState(projectRoot, state);
    appendRunEvent(state.eventPath, { type: 'run_completed', applied, summary: summary.trim() });
    return { completed: true, result: completed };
  } catch (error) {
    return { completed: false, result: resultForError(error) };
  }
}

function pauseForApproval(config, state, request, iteration, error) {
  const approval = createApproval(projectRoot, config, {
    ...error.details,
    runId: state.runId,
  });
  state.status = 'waiting_approval';
  state.pendingRequest = { request, iteration };
  state.approval = publicApproval(approval);
  saveRunState(projectRoot, state);
  appendRunEvent(state.eventPath, {
    type: 'approval_requested',
    iteration,
    approval: state.approval,
  });
  return waitingResult(state);
}

async function continueRun(config, state) {
  const modelConfig = connectionConfig();
  let tools = runtimeTools(config, state);

  try {
    for (
      let iteration = state.nextIteration;
      iteration <= state.maximumIterations;
      iteration += 1
    ) {
      state.nextIteration = iteration;
      state.status = 'running';
      saveRunState(projectRoot, state);

      const response = await chatCompletion(modelConfig, {
        model: state.model,
        messages: state.messages,
        tools: agentToolDefinitions,
        tool_choice: 'auto',
        parallel_tool_calls: false,
        temperature: modelConfig.temperature,
        max_tokens: modelConfig.maximumTokens,
      });
      const message = completionMessage(response);
      const requests = toolRequests(message);
      appendRunEvent(state.eventPath, {
        type: 'model_response',
        iteration,
        content: message.content ?? null,
        tools: requests.map((request) => ({ name: request.name, arguments: request.arguments })),
      });

      if (requests.length === 0) {
        state.messages.push(publicAssistantMessage(message));
        state.messages.push({
          role: 'user',
          content:
            'A coding-agent response must call one available tool. Inspect, edit, validate, or finish.',
        });
        state.nextIteration = iteration + 1;
        saveRunState(projectRoot, state);
        continue;
      }

      if (requests.length > 1) {
        throw new Error('The model returned parallel tool calls although they are disabled.');
      }

      state.messages.push(publicAssistantMessage(message));
      const request = requests[0];
      state.totalToolCalls += 1;
      if (state.totalToolCalls > config.maximumToolCalls) {
        throw new Error('Maximum tool-call budget exceeded.');
      }

      let result;
      if (request.invalidArguments) {
        result = { ok: false, error: 'Invalid tool arguments: ' + request.invalidArguments };
      } else if (request.name === 'finish') {
        const finish = finishRun(config, state, tools, request, iteration);
        if (finish.completed) {
          return finish.result;
        }
        result = finish.result;
      } else {
        try {
          result = tools.execute(request.name, request.arguments);
        } catch (error) {
          if (error instanceof ApprovalRequiredError) {
            return pauseForApproval(config, state, request, iteration, error);
          }
          result = resultForError(error);
        }
      }

      appendRunEvent(state.eventPath, {
        type: 'tool_result',
        iteration,
        tool: request.name,
        result,
      });
      state.messages.push(toolResultMessage(request, result));
      state.nextIteration = iteration + 1;
      saveRunState(projectRoot, state);
    }
    throw new Error('Maximum agent iterations exceeded without a successful finish.');
  } catch (error) {
    state.status = 'failed';
    state.error = resultForError(error).error;
    saveRunState(projectRoot, state);
    try {
      appendRunEvent(state.eventPath, { type: 'run_failed', error: state.error });
    } catch {
      // Preserve the original runtime error.
    }
    error.agentRun = {
      runId: state.runId,
      runRoot: state.runRoot,
      eventPath: state.eventPath,
      worktreeRoot: state.worktreeRoot,
      worktreeRetained: true,
    };
    throw error;
  }
}

export async function runAgent(task, options = {}) {
  if (typeof task !== 'string' || !task.trim()) {
    throw new Error('Agent task must be a non-empty string.');
  }

  const agentConfig = loadAgentConfig(projectRoot);
  loadLocalAiEnv();
  const iterations = maximumIterations(agentConfig, options.maximumIterations);
  const executorType = selectedExecutor(agentConfig, options.executor);
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
  let run;

  try {
    run = createAgentWorktree(projectRoot, options.runId, {
      linkDependencies: executorType !== 'docker',
    });
    const createdAt = new Date().toISOString();
    const state = {
      schemaVersion: 1,
      runId: run.runId,
      task: task.trim(),
      status: 'running',
      model,
      executor: executorType,
      createdAt,
      updatedAt: createdAt,
      maximumIterations: iterations,
      nextIteration: 1,
      totalToolCalls: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content:
            'TASK\n' +
            task.trim() +
            '\n\nStart by inspecting the repository with tools. Use finish only when complete.',
        },
      ],
      options: {
        apply: options.apply === true,
        allowProtected: options.allowProtected === true,
        allowHostExecution: options.allowHostExecution === true,
      },
      runRoot: run.runRoot,
      eventPath: run.eventPath,
      worktreeRoot: run.worktreeRoot,
      pendingRequest: null,
      approval: null,
      result: null,
      error: null,
    };
    saveRunState(projectRoot, state);
    appendRunEvent(run.eventPath, {
      type: 'run_started',
      task: task.trim(),
      model,
      executor: executorType,
      allowProtected: state.options.allowProtected,
      apply: state.options.apply,
    });
    return continueRun(agentConfig, state);
  } catch (error) {
    if (run && !error.agentRun) {
      try {
        removeAgentWorktree(projectRoot, run.worktreeRoot);
      } catch {
        error.agentRun = { ...run, worktreeRetained: true };
      }
    }
    throw error;
  }
}

export async function resumeAgent(runId) {
  const config = loadAgentConfig(projectRoot);
  const state = loadRunState(projectRoot, runId);
  if (state.status !== 'waiting_approval' || !state.pendingRequest || !state.approval?.id) {
    throw new Error('Agent run is not waiting for approval: ' + state.status);
  }

  const approval = loadApproval(projectRoot, state.approval.id);
  if (approval.runId !== state.runId) {
    throw new Error('Approval does not belong to this agent run.');
  }
  state.approval = publicApproval(approval);
  if (approval.status === 'pending') {
    saveRunState(projectRoot, state);
    return waitingResult(state);
  }

  const { request, iteration } = state.pendingRequest;
  let result;
  if (approval.status === 'approved') {
    const tools = runtimeTools(config, state, approval);
    try {
      result = tools.execute(request.name, request.arguments);
    } catch (error) {
      result = resultForError(error);
    }
  } else {
    result = {
      ok: false,
      error: 'Approval was ' + approval.status + '; the protected action was not executed.',
    };
  }

  appendRunEvent(state.eventPath, {
    type: 'approval_resolved',
    iteration,
    approval: state.approval,
    result,
  });
  state.messages.push(toolResultMessage(request, result));
  state.pendingRequest = null;
  state.approval = null;
  state.status = 'running';
  state.nextIteration = iteration + 1;
  saveRunState(projectRoot, state);
  return continueRun(config, state);
}

export function getAgentRun(runId, options = {}) {
  return publicRunState(loadRunState(projectRoot, runId), options);
}
