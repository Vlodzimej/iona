import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const repositoryIdPattern = /^[a-z0-9][a-z0-9-]{0,80}-[a-f0-9]{12}$/u;

function secureWrite(path, value) {
  const temporary = path + '.tmp-' + randomBytes(4).toString('hex');
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function registryPath(stateRoot) {
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);
  return resolve(stateRoot, 'repositories.json');
}

function loadRegistry(stateRoot) {
  const path = registryPath(stateRoot);
  if (!existsSync(path)) {
    return { schemaVersion: 1, repositories: {} };
  }
  const registry = JSON.parse(readFileSync(path, 'utf8'));
  if (registry.schemaVersion !== 1 || !registry.repositories) {
    throw new Error('Unsupported harness repository registry.');
  }
  return registry;
}

function gitRoot(candidate) {
  return realpathSync(
    execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: candidate,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
  );
}

function repositoryId(root) {
  const name =
    basename(root)
      .toLocaleLowerCase('en-US')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 60) || 'repository';
  const digest = createHash('sha256').update(root).digest('hex').slice(0, 12);
  return name + '-' + digest;
}

function contains(parent, child) {
  const candidate = relative(parent, child);
  return candidate === '' || (candidate !== '..' && !candidate.startsWith('..' + sep));
}

export function registerRepository(stateRoot, candidate) {
  const root = gitRoot(resolve(candidate));
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const canonicalStateRoot = realpathSync(stateRoot);
  if (contains(root, canonicalStateRoot) || contains(canonicalStateRoot, root)) {
    throw new Error('Harness state root and target repository must not overlap.');
  }
  const id = repositoryId(root);
  const registry = loadRegistry(stateRoot);
  const previous = registry.repositories[id];
  registry.repositories[id] = {
    id,
    root,
    registeredAt: previous?.registeredAt || new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
  };
  secureWrite(registryPath(stateRoot), registry);
  return registry.repositories[id];
}

export function resolveRepository(stateRoot, id) {
  if (!repositoryIdPattern.test(id)) {
    throw new Error('Invalid harness repository ID.');
  }
  const entry = loadRegistry(stateRoot).repositories[id];
  if (!entry) {
    throw new Error('Repository is not registered: ' + id + '.');
  }
  const root = gitRoot(entry.root);
  if (root !== entry.root || repositoryId(root) !== id) {
    throw new Error('Registered repository identity no longer matches its canonical path.');
  }
  return { ...entry, root };
}

export function repositoryStateRoot(stateRoot, id) {
  if (!repositoryIdPattern.test(id)) {
    throw new Error('Invalid harness repository ID.');
  }
  return resolve(stateRoot, 'repositories', id);
}
