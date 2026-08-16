#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { harnessStateRoot, requiredEnvironment } from './lib/paths.mjs';
import { VisualSessionManager } from './lib/visual-session.mjs';

const repositoryId = requiredEnvironment('IONIC_HARNESS_REPOSITORY_ID');
const manager = new VisualSessionManager({ stateRoot: harnessStateRoot(), repositoryId });
const server = new McpServer({ name: 'ionic-visual', version: '1.0.0' });

async function response(operation) {
  try {
    const result = await operation();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
      isError: result.ok === false,
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
  'list_targets',
  {
    description: 'List opaque human-registered loopback visual target IDs without exposing URLs.',
    inputSchema: {},
  },
  () => response(() => ({ ok: true, targets: manager.assets().targets })),
);

server.registerTool(
  'list_baselines',
  {
    description: 'List opaque human-registered PNG baseline IDs and dimensions.',
    inputSchema: {},
  },
  () => response(() => ({ ok: true, baselines: manager.assets().baselines })),
);

server.registerTool(
  'begin',
  {
    description: 'Open a registered target in an isolated deterministic browser session.',
    inputSchema: {
      targetId: z.string().min(1),
      profileName: z.enum(['desktop', 'iphone-15', 'pixel-8']).optional(),
    },
  },
  ({ targetId, profileName }) => response(() => manager.begin(targetId, profileName)),
);

server.registerTool(
  'status',
  {
    description: 'Read persisted visual-run status and safe artifact names.',
    inputSchema: { visualRunId: z.string().min(1) },
  },
  ({ visualRunId }) => response(() => manager.status(visualRunId)),
);

server.registerTool(
  'dom_snapshot',
  {
    description:
      'Capture bounded geometry, layout, and accessibility facts without DOM text or input values.',
    inputSchema: {
      visualRunId: z.string().min(1),
      maximumNodes: z.number().int().min(1).max(500).optional(),
    },
  },
  ({ visualRunId, maximumNodes }) => response(() => manager.snapshot(visualRunId, maximumNodes)),
);

server.registerTool(
  'measure',
  {
    description:
      'Detect touch-target, overflow, clipping, overlap, and accessible-name violations.',
    inputSchema: {
      visualRunId: z.string().min(1),
      minimumTouchWidth: z.number().min(24).max(64).optional(),
      minimumTouchHeight: z.number().min(24).max(64).optional(),
      geometryTolerance: z.number().min(0).max(8).optional(),
    },
  },
  ({ visualRunId, ...rules }) => response(() => manager.measure(visualRunId, rules)),
);

server.registerTool(
  'screenshot',
  {
    description: 'Capture a viewport PNG in the external visual-run artifact directory.',
    inputSchema: { visualRunId: z.string().min(1) },
  },
  ({ visualRunId }) => response(() => manager.screenshot(visualRunId)),
);

server.registerTool(
  'compare',
  {
    description: 'Compare the current screenshot with an immutable registered PNG baseline.',
    inputSchema: {
      visualRunId: z.string().min(1),
      baselineId: z.string().min(1),
      maximumMismatchPercent: z.number().min(0).max(100).optional(),
      pixelThreshold: z.number().min(0).max(1).optional(),
    },
  },
  ({ visualRunId, baselineId, ...options }) =>
    response(() => manager.compare(visualRunId, baselineId, options)),
);

server.registerTool(
  'report',
  {
    description:
      'Create a sanitized standalone HTML Visual QA report outside the target repository.',
    inputSchema: { visualRunId: z.string().min(1) },
  },
  ({ visualRunId }) => response(() => manager.report(visualRunId)),
);

server.registerTool(
  'finish',
  {
    description:
      'Close the browser and mark a visual run completed without changing the coding run.',
    inputSchema: { visualRunId: z.string().min(1) },
  },
  ({ visualRunId }) => response(() => manager.finish(visualRunId)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Ionic Visual QA MCP server is ready.');

async function shutdown() {
  await manager.shutdown();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
