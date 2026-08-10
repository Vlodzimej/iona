#!/usr/bin/env node
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideApproval } from './lib/approval.mjs';
import { loadAgentConfig } from './lib/config.mjs';
import { dockerStatus } from './lib/executor.mjs';
import { getAgentRun, resumeAgent, runAgent } from './lib/runtime.mjs';
import { createRunId } from './lib/worktree.mjs';
import { loadLocalAiEnv, projectRoot } from '../local-ai/lib/env.mjs';

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function authorized(request, token) {
  const header = request.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(token, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function readBody(request, maximumBytes) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let bytes = 0;
    let exceeded = false;
    request.on('data', (chunk) => {
      if (exceeded) {
        return;
      }
      bytes += chunk.length;
      if (bytes > maximumBytes) {
        exceeded = true;
        reject(new Error('Request body exceeds the configured limit.'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (exceeded) {
        return;
      }
      if (bytes === 0) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function isLoopback(hostname) {
  return ['127.0.0.1', '::1', 'localhost'].includes(hostname);
}

function publicError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/does not exist|not waiting|already|invalid|must|exceeds/iu.test(message)) {
    return message;
  }
  return 'Agent operation failed. Inspect the local run log.';
}

export function createAgentApi(options) {
  const {
    config,
    token,
    run = runAgent,
    resume = resumeAgent,
    status = getAgentRun,
    decide = (id, decision, actor) =>
      decideApproval(options.projectRoot || projectRoot, id, decision, actor),
  } = options;
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('Agent API token must contain at least 32 characters.');
  }
  const active = new Map();

  function launch(runId, operation) {
    const promise = Promise.resolve()
      .then(operation)
      .catch(() => undefined)
      .finally(() => active.delete(runId));
    active.set(runId, promise);
  }

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://agent.local');
      if (request.method === 'GET' && url.pathname === '/health') {
        json(response, 200, { ok: true, service: 'ionic-llm-agent-api' });
        return;
      }
      if (!authorized(request, token)) {
        json(response, 401, { error: 'Unauthorized.' });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/runs') {
        if (active.size >= config.api.maximumConcurrentRuns) {
          json(response, 429, { error: 'Agent concurrency limit reached.' });
          return;
        }
        const body = await readBody(request, config.api.maximumBodyBytes);
        if (typeof body.task !== 'string' || !body.task.trim()) {
          json(response, 400, { error: 'task must be a non-empty string.' });
          return;
        }
        const runId = createRunId();
        const maximumIterations = body.maximumIterations;
        if (
          maximumIterations !== undefined &&
          (!Number.isInteger(maximumIterations) || maximumIterations < 1 || maximumIterations > 100)
        ) {
          json(response, 400, { error: 'maximumIterations must be between 1 and 100.' });
          return;
        }
        launch(runId, () =>
          run(body.task, {
            runId,
            executor: 'docker',
            maximumIterations,
            apply: false,
            allowProtected: false,
            allowHostExecution: false,
          }),
        );
        json(response, 202, { runId, status: 'queued' });
        return;
      }

      const runMatch = url.pathname.match(/^\/v1\/runs\/([a-zA-Z0-9-]+)$/u);
      if (request.method === 'GET' && runMatch) {
        try {
          json(response, 200, status(runMatch[1], { includePatch: url.searchParams.has('patch') }));
        } catch (error) {
          if (active.has(runMatch[1])) {
            json(response, 200, { runId: runMatch[1], status: 'queued' });
          } else {
            throw error;
          }
        }
        return;
      }

      const resumeMatch = url.pathname.match(/^\/v1\/runs\/([a-zA-Z0-9-]+)\/resume$/u);
      if (request.method === 'POST' && resumeMatch) {
        if (active.size >= config.api.maximumConcurrentRuns) {
          json(response, 429, { error: 'Agent concurrency limit reached.' });
          return;
        }
        const current = status(resumeMatch[1]);
        if (current.status !== 'waiting_approval') {
          json(response, 409, { error: 'Agent run is not waiting for approval.' });
          return;
        }
        launch(resumeMatch[1], () => resume(resumeMatch[1]));
        json(response, 202, { runId: resumeMatch[1], status: 'resuming' });
        return;
      }

      const approvalMatch = url.pathname.match(/^\/v1\/approvals\/([a-zA-Z0-9-]+)$/u);
      if (request.method === 'POST' && approvalMatch) {
        const body = await readBody(request, config.api.maximumBodyBytes);
        if (!['approved', 'rejected'].includes(body.decision)) {
          json(response, 400, { error: 'decision must be approved or rejected.' });
          return;
        }
        const approval = decide(
          approvalMatch[1],
          body.decision,
          typeof body.actor === 'string' ? body.actor : 'remote-api-user',
        );
        json(response, 200, {
          id: approval.id,
          runId: approval.runId,
          status: approval.status,
        });
        return;
      }

      json(response, 404, { error: 'Not found.' });
    } catch (error) {
      if (!response.headersSent) {
        json(response, 400, { error: publicError(error) });
      }
    }
  });
}

async function main() {
  loadLocalAiEnv();
  const config = loadAgentConfig(projectRoot);
  const hostname = process.env.LOCAL_AGENT_API_HOST?.trim() || config.api.hostname;
  const port = Number(process.env.LOCAL_AGENT_API_PORT || config.api.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('LOCAL_AGENT_API_PORT must be a valid TCP port.');
  }
  if (!isLoopback(hostname) && process.env.LOCAL_AGENT_API_ALLOW_REMOTE !== '1') {
    throw new Error('Non-loopback binding requires LOCAL_AGENT_API_ALLOW_REMOTE=1.');
  }
  const token = process.env[config.api.tokenEnvironmentVariable];
  const docker = dockerStatus(config);
  if (!docker.ok) {
    throw new Error(docker.error);
  }
  const server = createAgentApi({ config, token, projectRoot });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, resolvePromise);
  });
  console.log('Agent API listening on http://' + hostname + ':' + port);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error('Agent API failed: ' + error.message);
    process.exitCode = 1;
  });
}
