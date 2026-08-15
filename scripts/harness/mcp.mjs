#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { harnessRoot, harnessStateRoot, requiredEnvironment } from './lib/paths.mjs';
import { HarnessSessionManager } from './lib/session.mjs';

const repositoryId = requiredEnvironment('IONIC_HARNESS_REPOSITORY_ID');
const profileId = process.env.IONIC_HARNESS_PROFILE?.trim() || 'angular-ionic-capacitor';
const manager = new HarnessSessionManager({
  harnessRoot,
  stateRoot: harnessStateRoot(),
  repositoryId,
  profileId,
  executor: 'docker',
});

const server = new McpServer({
  name: 'ionic-llm-harness',
  version: '1.0.0',
});

function response(operation) {
  try {
    const result = operation();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
      isError: result.ok === false && !String(result.status || '').startsWith('waiting_'),
    };
  } catch (error) {
    const result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
      isError: true,
    };
  }
}

server.registerTool(
  'begin',
  {
    description:
      'Start an isolated harness run for the registered repository. Call once before repository tools.',
    inputSchema: {
      task: z.string().min(1).max(10_000).describe('The concrete coding task from the user.'),
    },
  },
  ({ task }) => response(() => manager.begin(task)),
);

server.registerTool(
  'status',
  {
    description: 'Read persisted status for a harness run without changing the repository.',
    inputSchema: { runId: z.string().min(1) },
  },
  ({ runId }) => response(() => manager.status(runId)),
);

server.registerTool(
  'list_files',
  {
    description: 'List policy-allowed files in the isolated worktree.',
    inputSchema: {
      runId: z.string().min(1),
      glob: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
  },
  ({ runId, ...args }) => response(() => manager.execute(runId, 'list_files', args)),
);

server.registerTool(
  'search',
  {
    description: 'Search literal text only inside policy-allowed repository paths.',
    inputSchema: {
      runId: z.string().min(1),
      query: z.string().min(1),
      glob: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  ({ runId, ...args }) => response(() => manager.execute(runId, 'search', args)),
);

server.registerTool(
  'read_file',
  {
    description: 'Read a bounded text range from a policy-allowed repository file.',
    inputSchema: {
      runId: z.string().min(1),
      path: z.string().min(1),
      startLine: z.number().int().min(1).optional(),
      endLine: z.number().int().min(1).optional(),
    },
  },
  ({ runId, ...args }) => response(() => manager.execute(runId, 'read_file', args)),
);

server.registerTool(
  'apply_patch',
  {
    description:
      'Validate and apply a unified Git diff to the isolated worktree. Protected paths pause for exact human approval.',
    inputSchema: {
      runId: z.string().min(1),
      patch: z.string().min(1),
    },
  },
  ({ runId, patch }) => response(() => manager.execute(runId, 'apply_patch', { patch })),
);

server.registerTool(
  'git_diff',
  {
    description: 'Show the bounded current diff from the isolated worktree.',
    inputSchema: { runId: z.string().min(1) },
  },
  ({ runId }) => response(() => manager.execute(runId, 'git_diff')),
);

server.registerTool(
  'run_checks',
  {
    description:
      'Run an allowlisted validation profile in the no-network Docker Executor. Use fast during iteration.',
    inputSchema: {
      runId: z.string().min(1),
      profile: z.enum(['fast', 'build', 'full']),
    },
  },
  ({ runId, profile }) => response(() => manager.execute(runId, 'run_checks', { profile })),
);

server.registerTool(
  'finish',
  {
    description:
      'Run the mandatory full validation and seal an unchanged patch as ready for human review and local application.',
    inputSchema: {
      runId: z.string().min(1),
      summary: z.string().min(1).max(4000),
    },
  },
  ({ runId, summary }) => response(() => manager.finish(runId, summary)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Ionic LLM harness MCP server is ready.');
