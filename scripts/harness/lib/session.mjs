import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ApprovalRequiredError, approvalMatches } from '../../agent/lib/approval.mjs';
import { createExecutor } from '../../agent/lib/executor.mjs';
import { createAgentTools } from '../../agent/lib/tools.mjs';
import {
  applyWorktreePatch,
  createAgentWorktree,
  createRunId,
  removeAgentWorktree,
  worktreePatch,
  worktreeStatus,
} from '../../agent/lib/worktree.mjs';
import { loadHarnessProfile } from './profile.mjs';
import { prepareProjectRunner } from './dependencies.mjs';
import { repositoryStateRoot, resolveRepository } from './registry.mjs';
import {
  appendHarnessEvent,
  consumeHarnessApproval,
  createHarnessApproval,
  loadHarnessApproval,
  loadHarnessRun,
  saveHarnessRun,
} from './store.mjs';

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function patchHash(worktreeRoot) {
  return createHash('sha256').update(worktreePatch(worktreeRoot)).digest('hex');
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
    actor: approval.actor,
  };
}

function publicRun(state, options = {}) {
  const result = {
    ok: true,
    repositoryId: state.repositoryId,
    runId: state.runId,
    status: state.status,
    task: state.task,
    profile: state.profile,
    totalToolCalls: state.totalToolCalls,
    approval: state.approval || null,
    validation: state.validation || null,
    summary: state.summary || null,
    applied: state.status === 'applied',
  };
  if (options.includeInternalPaths) {
    result.worktreeRoot = state.worktreeRoot;
    result.runRoot = state.runRoot;
  }
  if (options.includePatch) {
    result.patch = worktreePatch(state.worktreeRoot);
  }
  return result;
}

export class HarnessSessionManager {
  constructor({
    harnessRoot,
    stateRoot,
    repositoryId,
    profileId,
    executor = 'docker',
    executorFactory = createExecutor,
    runnerPreparer = prepareProjectRunner,
    profile,
  }) {
    this.harnessRoot = harnessRoot;
    this.stateRoot = stateRoot;
    this.repository = resolveRepository(stateRoot, repositoryId);
    this.repositoryRoot = repositoryStateRoot(stateRoot, repositoryId);
    this.profile = profile || loadHarnessProfile(harnessRoot, profileId);
    this.executor = executor;
    this.executorFactory = executorFactory;
    this.runnerPreparer = runnerPreparer;
  }

  configForState(state) {
    return {
      ...this.profile.config,
      executor: {
        ...this.profile.config.executor,
        docker: {
          ...this.profile.config.executor.docker,
          image: state.runnerImage || this.profile.config.executor.docker.image,
        },
      },
    };
  }

  ensureProjectRunner(state) {
    const prepared = this.runnerPreparer({
      harnessRoot: this.harnessRoot,
      stateRoot: this.stateRoot,
      projectRoot: state.worktreeRoot,
    });
    if (state.runnerImage !== prepared.image || state.dependencyDigest !== prepared.digest) {
      state.runnerImage = prepared.image;
      state.dependencyDigest = prepared.digest;
      saveHarnessRun(this.repositoryRoot, state);
      appendHarnessEvent(this.repositoryRoot, state.runId, {
        type: 'project_runner_ready',
        image: prepared.image,
        dependencyDigest: prepared.digest,
        cached: prepared.cached,
      });
    }
    return prepared;
  }

  loadState(runId) {
    const state = loadHarnessRun(this.repositoryRoot, runId);
    const expectedWorktree = resolve(this.repositoryRoot, 'worktrees', runId);
    const expectedRunRoot = resolve(this.repositoryRoot, 'runs', runId);
    if (
      state.repositoryId !== this.repository.id ||
      state.profile !== this.profile.id ||
      resolve(state.worktreeRoot) !== expectedWorktree ||
      resolve(state.runRoot) !== expectedRunRoot
    ) {
      throw new Error(
        'Harness run state does not match its repository, profile, or isolated roots.',
      );
    }
    return state;
  }

  begin(task) {
    if (typeof task !== 'string' || !task.trim()) {
      throw new Error('Harness task must be a non-empty string.');
    }
    const runId = createRunId();
    const run = createAgentWorktree(this.repository.root, runId, {
      agentRoot: this.repositoryRoot,
      linkDependencies: this.executor !== 'docker',
    });
    const createdAt = new Date().toISOString();
    const state = {
      schemaVersion: 1,
      repositoryId: this.repository.id,
      runId,
      task: task.trim(),
      profile: this.profile.id,
      executor: this.executor,
      status: 'active',
      baseCommit: git(this.repository.root, ['rev-parse', 'HEAD']),
      worktreeRoot: run.worktreeRoot,
      runRoot: run.runRoot,
      totalToolCalls: 0,
      approval: null,
      validation: null,
      runnerImage: null,
      dependencyDigest: null,
      summary: null,
      createdAt,
      updatedAt: createdAt,
    };
    saveHarnessRun(this.repositoryRoot, state);
    appendHarnessEvent(this.repositoryRoot, runId, {
      type: 'run_started',
      task: state.task,
      profile: state.profile,
      executor: state.executor,
      baseCommit: state.baseCommit,
    });
    return publicRun(state);
  }

  status(runId, options = {}) {
    return publicRun(this.loadState(runId), options);
  }

  execute(runId, name, args = {}) {
    const state = this.loadState(runId);
    if (!['active', 'waiting_approval'].includes(state.status)) {
      throw new Error('Harness run does not accept tools in status ' + state.status + '.');
    }
    state.totalToolCalls += 1;
    if (state.totalToolCalls > this.profile.config.maximumToolCalls) {
      saveHarnessRun(this.repositoryRoot, state);
      throw new Error('Maximum tool-call budget exceeded.');
    }

    let approvalGrant;
    if (state.approval) {
      const approval = loadHarnessApproval(this.repositoryRoot, state.approval.id);
      state.approval = publicApproval(approval);
      if (approval.status === 'pending') {
        saveHarnessRun(this.repositoryRoot, state);
        return {
          ok: false,
          status: 'waiting_approval',
          runId,
          approval: state.approval,
          instruction: 'A human must approve or reject this exact protected patch.',
        };
      }
      if (approval.status === 'approved') {
        if (name !== 'apply_patch') {
          saveHarnessRun(this.repositoryRoot, state);
          return {
            ok: false,
            status: 'approval_ready',
            runId,
            approval: state.approval,
            instruction: 'Retry the exact protected apply_patch request to consume the approval.',
          };
        }
        approvalGrant = approval;
      } else {
        state.status = 'active';
        state.approval = null;
        saveHarnessRun(this.repositoryRoot, state);
        return {
          ok: false,
          status: 'approval_' + approval.status,
          runId,
          instruction: 'Revise the patch or continue without the protected change.',
        };
      }
    }

    if (name === 'run_checks') {
      this.ensureProjectRunner(state);
    }
    const context = {
      config: this.configForState(state),
      projectRoot: this.repository.root,
      worktreeRoot: state.worktreeRoot,
      runRoot: state.runRoot,
      runId,
      type: state.executor,
      allowProtected: false,
      allowHostExecution: false,
      approvalGrant,
    };
    context.executor = this.executorFactory(context);
    const tools = createAgentTools(context);

    try {
      const result = tools.execute(name, args);
      if (
        approvalGrant &&
        approvalMatches(approvalGrant, {
          runId,
          capability: 'apply_patch',
          argumentHash: createHash('sha256')
            .update(args.patch || '')
            .digest('hex'),
          paths: approvalGrant.paths,
        })
      ) {
        consumeHarnessApproval(this.repositoryRoot, approvalGrant.id);
        state.approval = null;
        state.status = 'active';
      }
      state.validation = null;
      saveHarnessRun(this.repositoryRoot, state);
      appendHarnessEvent(this.repositoryRoot, runId, { type: 'tool_completed', tool: name });
      return { ...result, runId, status: state.status };
    } catch (error) {
      if (error instanceof ApprovalRequiredError) {
        const approval = createHarnessApproval(this.repositoryRoot, this.profile.config, {
          ...error.details,
          runId,
        });
        state.status = 'waiting_approval';
        state.approval = publicApproval(approval);
        saveHarnessRun(this.repositoryRoot, state);
        appendHarnessEvent(this.repositoryRoot, runId, {
          type: 'approval_requested',
          approvalId: approval.id,
          capability: approval.capability,
          paths: approval.paths,
        });
        return {
          ok: false,
          status: 'waiting_approval',
          runId,
          repositoryId: state.repositoryId,
          approval: state.approval,
          instruction: 'A human must approve or reject this exact protected patch.',
        };
      }
      appendHarnessEvent(this.repositoryRoot, runId, {
        type: 'tool_failed',
        tool: name,
        error: error.message,
      });
      saveHarnessRun(this.repositoryRoot, state);
      throw error;
    }
  }

  finish(runId, summary) {
    const state = this.loadState(runId);
    if (state.status === 'waiting_approval') {
      throw new Error('Resolve the pending protected-patch approval before finishing.');
    }
    if (state.status !== 'active') {
      throw new Error('Harness run cannot finish in status ' + state.status + '.');
    }
    this.ensureProjectRunner(state);
    const context = {
      config: this.configForState(state),
      projectRoot: this.repository.root,
      worktreeRoot: state.worktreeRoot,
      runRoot: state.runRoot,
      type: state.executor,
      allowHostExecution: false,
    };
    const executor = this.executorFactory(context);
    const before = executor.patchHash();
    const validation = executor.runChecks(this.profile.config.requiredFinishCheck);
    const after = executor.patchHash();
    if (!validation.ok) {
      state.validation = validation;
      saveHarnessRun(this.repositoryRoot, state);
      return { ok: false, runId, status: 'validation_failed', validation };
    }
    if (before !== after || validation.patchHash !== after) {
      throw new Error('The worktree changed while final validation was running.');
    }
    state.status = 'ready';
    state.summary = String(summary || '')
      .trim()
      .slice(0, 4000);
    state.validation = validation;
    state.validatedPatchHash = after;
    saveHarnessRun(this.repositoryRoot, state);
    appendHarnessEvent(this.repositoryRoot, runId, {
      type: 'run_ready',
      profile: validation.profile,
      patchHash: after,
    });
    return publicRun(state);
  }

  apply(runId) {
    const state = this.loadState(runId);
    if (state.status !== 'ready' || !state.validation?.ok) {
      throw new Error('Only a successfully validated ready run can be applied.');
    }
    if (git(this.repository.root, ['rev-parse', 'HEAD']) !== state.baseCommit) {
      throw new Error('The primary repository HEAD changed after the harness run started.');
    }
    if (patchHash(state.worktreeRoot) !== state.validatedPatchHash) {
      throw new Error('The worktree patch changed after validation.');
    }
    const changed = applyWorktreePatch(this.repository.root, state.worktreeRoot);
    state.status = 'applied';
    state.appliedAt = new Date().toISOString();
    saveHarnessRun(this.repositoryRoot, state);
    appendHarnessEvent(this.repositoryRoot, runId, { type: 'run_applied', changed });
    return publicRun(state);
  }

  discard(runId) {
    const state = this.loadState(runId);
    if (state.status === 'applied') {
      throw new Error('An applied run cannot be discarded.');
    }
    removeAgentWorktree(this.repository.root, state.worktreeRoot);
    state.status = 'discarded';
    state.discardedAt = new Date().toISOString();
    saveHarnessRun(this.repositoryRoot, state);
    appendHarnessEvent(this.repositoryRoot, runId, { type: 'run_discarded' });
    return publicRun(state);
  }

  diff(runId) {
    const state = this.loadState(runId);
    return {
      ok: true,
      runId,
      status: state.status,
      worktreeStatus: worktreeStatus(state.worktreeRoot),
      patch: worktreePatch(state.worktreeRoot),
    };
  }
}
