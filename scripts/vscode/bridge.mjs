import { createInterface } from 'node:readline';
import { ExtensionService } from './service.mjs';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 15))
  throw new Error('The bridge requires Node >=24.15.');
const stateRoot = process.argv[2];
if (!stateRoot) throw new Error('An external state directory is required.');
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const service = new ExtensionService({ stateRoot, emit: (event) => send({ event }) });
function publicError(error) {
  const message = error instanceof Error ? error.message : '';
  const safeMessages = [
    'The primary worktree must be clean before an agent run. Commit or stash current changes.',
    'Docker CLI is not installed.',
    'Project runner image build timed out',
    'Cannot build the project-specific runner image',
  ];
  return safeMessages.some((entry) => message.startsWith(entry))
    ? message
    : 'Operation failed. Check server availability, model, skills, Docker and harness configuration.';
}
let active;
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', async (line) => {
  let request;
  try {
    if (line.length > 300000) throw new Error('Request too large.');
    request = JSON.parse(line);
    if (request.method === 'cancel') {
      active?.abort();
      return;
    }
    if (active) throw new Error('Another operation is running.');
    const controller = new AbortController();
    active = controller;
    try {
      send({
        id: request.id,
        result: await service.handle(request.method, request.params, controller.signal),
      });
    } finally {
      active = undefined;
    }
  } catch (error) {
    const safe =
      error.name === 'AbortError'
        ? 'Cancelled. The isolated worktree is retained.'
        : publicError(error);
    send({ id: request?.id, error: safe });
  }
});
input.on('close', () => {
  active?.abort();
  process.exit(0);
});
