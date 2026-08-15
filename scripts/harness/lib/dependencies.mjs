import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const dependencyLabel = 'io.ionic-llm-harness.dependencies';

function regularFile(path, label) {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(label + ' must be a regular file, not a symbolic link.');
  }
  return readFileSync(path);
}

export function projectRunnerDescriptor(harnessRoot, projectRoot) {
  const inputs = [
    ['package.json', resolve(projectRoot, 'package.json')],
    ['package-lock.json', resolve(projectRoot, 'package-lock.json')],
    ['runner.mjs', resolve(harnessRoot, 'docker/agent-runner.mjs')],
    ['Dockerfile', resolve(harnessRoot, 'docker/project-agent-runner.Dockerfile')],
  ];
  const hash = createHash('sha256');
  const files = {};
  for (const [name, path] of inputs) {
    const content = regularFile(path, path);
    files[name] = { path, content };
    hash.update(name).update('\0').update(content).update('\0');
  }
  const digest = hash.digest('hex');
  return {
    digest,
    image: 'ionic-llm-project-runner:sha256-' + digest.slice(0, 24),
    files,
  };
}

function imageDigest(image) {
  const result = spawnSync(
    'docker',
    ['image', 'inspect', '--format', `{{ index .Config.Labels "${dependencyLabel}" }}`, image],
    { encoding: 'utf8', timeout: 10_000 },
  );
  return result.status === 0 ? result.stdout.trim() : null;
}

export function prepareProjectRunner({ harnessRoot, stateRoot, projectRoot }) {
  const descriptor = projectRunnerDescriptor(harnessRoot, projectRoot);
  if (imageDigest(descriptor.image) === descriptor.digest) {
    return { image: descriptor.image, digest: descriptor.digest, cached: true };
  }

  const contextRoot = resolve(stateRoot, 'dependency-images', descriptor.digest);
  mkdirSync(contextRoot, { recursive: true, mode: 0o700 });
  for (const [name, file] of Object.entries(descriptor.files)) {
    const destination = resolve(contextRoot, name);
    copyFileSync(file.path, destination);
    chmodSync(destination, 0o600);
  }
  const result = spawnSync(
    'docker',
    [
      'build',
      '--file',
      resolve(contextRoot, 'Dockerfile'),
      '--tag',
      descriptor.image,
      '--build-arg',
      'HARNESS_DEPENDENCY_DIGEST=' + descriptor.digest,
      contextRoot,
    ],
    { encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error?.code === 'ENOENT') {
    throw new Error('Docker CLI is not installed.');
  }
  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error('Project runner image build timed out.');
  }
  if (result.status !== 0 || imageDigest(descriptor.image) !== descriptor.digest) {
    const output = (result.stderr || result.stdout || result.error?.message || 'unknown error')
      .trim()
      .slice(-12_000);
    throw new Error('Cannot build the project-specific runner image: ' + output);
  }
  return { image: descriptor.image, digest: descriptor.digest, cached: false };
}
