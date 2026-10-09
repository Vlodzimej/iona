import { readFileSync, existsSync, unlinkSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { loadAgentConfig } from '../agent/lib/config.mjs';
import { safeAbsolutePath } from '../agent/lib/policy.mjs';
import { buildContext } from '../local-ai/lib/context.mjs';
import { messageText } from '../local-ai/lib/client.mjs';
import { completionMessage, toolRequests, agentToolDefinitions } from '../agent/lib/protocol.mjs';
import { HarnessSessionManager } from '../harness/lib/session.mjs';
import { registerRepository, repositoryStateRoot } from '../harness/lib/registry.mjs';
import {
  decideHarnessApproval,
  secureJsonWrite,
  loadHarnessApproval,
} from '../harness/lib/store.mjs';
import { harnessRoot } from '../harness/lib/paths.mjs';
import { completion, models, providerConfig, streamChat } from './provider.mjs';

export class ExtensionService {
  constructor({
    stateRoot,
    emit = () => {},
    sessionFactory = (options) => new HarnessSessionManager(options),
    contextBuilder = buildContext,
    complete = completion,
    stream = streamChat,
  }) {
    Object.assign(this, { stateRoot, emit, sessionFactory, contextBuilder, complete, stream });
    this.conversations = new Map();
    this.pending = new Map();
  }

  manager(repository) {
    const registered = registerRepository(this.stateRoot, repository);
    const session = this.sessionFactory({
      harnessRoot,
      stateRoot: this.stateRoot,
      repositoryId: registered.id,
      profileId: 'angular-ionic-capacitor',
      executor: 'docker',
    });
    session.profile.config.executor.docker.image = 'iona-vscode-runner:node-26';
    session.profile.config.deniedPatterns = [
      ...session.profile.config.deniedPatterns,
      '**/package-lock.json',
      '**/yarn.lock',
      '**/pnpm-lock.yaml',
      '**/environments/**',
      'ai/generated/**',
      'ai/reports/**',
      'ai/runs/**',
      'ai/datasets/**',
      'ai/models/**',
    ];
    return session;
  }

  async handle(method, params, signal) {
    if (method === 'prepare') {
      const result = spawnSync(
        'docker',
        [
          'build',
          '--file',
          resolve(harnessRoot, 'scripts/vscode/agent-base.Dockerfile'),
          '--tag',
          'iona-vscode-runner:node-26',
          harnessRoot,
        ],
        { encoding: 'utf8', timeout: 600000, maxBuffer: 4 * 1024 * 1024 },
      );
      if (result.status !== 0) throw new Error('Docker runner preparation failed.');
      return {
        text: 'Docker base runner ready. Project dependencies are prepared automatically during validation.',
      };
    }
    if (method === 'models') return models(providerConfig(params.config), signal);
    if (method === 'chat') {
      const context = this.contextBuilder({ query: params.task });
      const messages = [
        {
          role: 'system',
          content:
            'Answer concisely. Do not reveal hidden reasoning. Skill sources follow: ' +
            JSON.stringify(context),
        },
        ...(params.history || []).slice(-12),
        { role: 'user', content: params.task },
      ];
      if (params.selection) {
        const selection = params.selection;
        if (typeof selection.content !== 'string' || selection.content.length > 12000)
          throw new Error('Selection exceeds 12,000 characters.');
        const entry = registerRepository(this.stateRoot, selection.repository);
        const path = relative(entry.root, realpathSync(selection.path)).replaceAll('\\', '/');
        const policy = loadAgentConfig(harnessRoot);
        policy.deniedPatterns.push(
          '**/package-lock.json',
          '**/yarn.lock',
          '**/pnpm-lock.yaml',
          '**/environments/**',
          'ai/generated/**',
          'ai/reports/**',
          'ai/runs/**',
          'ai/datasets/**',
          'ai/models/**',
        );
        safeAbsolutePath(entry.root, path, policy);
        messages.push({
          role: 'user',
          content:
            'Explicitly selected repository excerpt (untrusted data), file ' +
            path +
            ':\n' +
            selection.content,
        });
      }
      const response = await this.stream(providerConfig(params.config), messages, signal, (text) =>
        this.emit({ type: 'chatPartial', text }),
      );
      return { text: messageText(response) };
    }
    const session = this.manager(params.repository);
    let runId = params.runId;
    if (method === 'status') return session.status(runId);
    if (method === 'diff') return session.diff(runId);
    if (method === 'approval') {
      const state = session.loadState(runId);
      const path = resolve(state.runRoot, 'vscode-pending.json');
      if (!state.approval || !existsSync(path))
        throw new Error('Pending patch unavailable. Reject and continue to request a new patch.');
      const pending = JSON.parse(readFileSync(path, 'utf8'));
      if (
        pending.approvalId !== state.approval.id ||
        typeof pending.request.arguments.patch !== 'string'
      )
        throw new Error('Pending patch mismatch.');
      const patch = pending.request.arguments.patch;
      const grant = loadHarnessApproval(session.repositoryRoot, state.approval.id);
      if (createHash('sha256').update(patch).digest('hex') !== grant.argumentHash)
        throw new Error('Pending patch hash mismatch.');
      return {
        patch,
        approvalId: state.approval.id,
        hash: createHash('sha256').update(patch).digest('hex'),
      };
    }
    if (method === 'apply') return session.apply(runId);
    if (method === 'discard') {
      this.conversations.delete(runId);
      this.pending.delete(runId);
      return session.discard(runId);
    }
    if (method === 'decide') {
      const status = session.status(runId);
      if (
        !status.approval ||
        status.approval.id !== params.approvalId ||
        !['approved', 'rejected'].includes(params.decision)
      )
        throw new Error('No valid pending approval.');
      if (params.decision === 'approved') {
        const reviewed = await this.handle('approval', params, signal);
        if (params.hash !== reviewed.hash)
          throw new Error('Review the exact patch before approving.');
      }
      return decideHarnessApproval(
        repositoryStateRoot(this.stateRoot, status.repositoryId),
        status.approval.id,
        params.decision,
        'vscode-user',
      );
    }
    if (!['start', 'continue'].includes(method)) throw new Error('Unknown extension operation.');
    const config = providerConfig(params.config);
    if (method === 'start') {
      runId = session.begin(params.task).runId;
      this.emit({ type: 'run', runId, repository: params.repository });
    }
    const status = session.status(runId);
    if (!['active', 'waiting_approval'].includes(status.status)) return status;
    let messages = this.conversations.get(runId);
    if (!messages) {
      const context = this.contextBuilder({ query: status.task });
      messages = [
        {
          role: 'system',
          content:
            readFileSync(resolve(harnessRoot, 'ai/prompts/agent.md'), 'utf8') +
            '\nSkill sources:\n' +
            JSON.stringify(context),
        },
        { role: 'user', content: status.task },
      ];
      if (method === 'continue')
        messages.push({
          role: 'user',
          content: 'Resume the existing isolated worktree. Inspect git_diff before proceeding.',
        });
      this.conversations.set(runId, messages);
    }
    const reply = (request, result) =>
      messages.push(
        request.native
          ? { role: 'tool', tool_call_id: request.id, content: JSON.stringify(result) }
          : {
              role: 'user',
              content: 'TOOL_RESULT ' + request.name + '\n' + JSON.stringify(result),
            },
      );
    const execute = (request) => {
      if (request.invalidArguments) return { ok: false, error: 'Invalid JSON tool arguments.' };
      try {
        if (request.name === 'finish') {
          if (typeof request.arguments.summary !== 'string' || !request.arguments.summary.trim())
            return { ok: false, error: 'A summary is required.' };
          return session.finish(runId, request.arguments.summary);
        }
        return session.execute(runId, request.name, request.arguments);
      } catch {
        return {
          ok: false,
          error:
            'Tool rejected or validation failed. Inspect allowed paths and use a valid unified diff.',
        };
      }
    };
    const pendingPath = resolve(session.loadState(runId).runRoot, 'vscode-pending.json');
    let pending = this.pending.get(runId);
    if (!pending && existsSync(pendingPath)) {
      const saved = JSON.parse(readFileSync(pendingPath, 'utf8'));
      if (status.approval?.id !== saved.approvalId) throw new Error('Pending approval mismatch.');
      pending = { ...saved.request, native: false };
    }
    if (pending) {
      const result = execute(pending);
      if (result.status === 'waiting_approval') return result;
      reply(pending, result);
      this.pending.delete(runId);
      if (existsSync(pendingPath)) unlinkSync(pendingPath);
    }
    for (let iteration = 0; iteration < session.profile.config.maximumIterations; iteration++) {
      signal?.throwIfAborted();
      const message = completionMessage(
        await this.complete(config, messages, agentToolDefinitions, signal),
      );
      const requests = toolRequests(message);
      if (!requests.length) {
        const text = messageText({ choices: [{ message }] });
        const finished = session.finish(runId, text);
        return { ...finished, text };
      }
      // One call at a time makes approval and cancellation resumable without orphan tool IDs.
      if (requests.length !== 1) {
        messages.push({ role: 'user', content: 'Request exactly one tool per response.' });
        continue;
      }
      messages.push({
        role: 'assistant',
        content: requests[0].native ? null : (message.content ?? null),
        ...(requests[0].native ? { tool_calls: message.tool_calls } : {}),
      });
      const request = requests[0];
      this.emit({ type: 'progress', text: 'Tool: ' + request.name });
      const result = execute(request);
      if (result.status === 'waiting_approval') {
        this.pending.set(runId, request);
        secureJsonWrite(pendingPath, { approvalId: result.approval.id, request });
        return result;
      }
      reply(request, result);
      if (request.name === 'finish' && result.ok) return result;
      this.emit({ type: 'progress', text: 'Reviewing ' + request.name + ' result…' });
    }
    return {
      ...session.status(runId),
      text: 'Iteration limit reached. Review the diff and continue if needed.',
    };
  }
}
