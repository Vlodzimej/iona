import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

function result(level, label, detail, remediation) {
  return { level, label, detail, remediation };
}

function run(command, args, options, runner) {
  const execution = runner(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  return {
    ok: !execution.error && execution.status === 0,
    output: String(execution.stdout || execution.stderr || '')
      .trim()
      .split(/\r?\n/u)[0],
  };
}

function contains(parent, child) {
  const candidate = relative(parent, child);
  return candidate === '' || (candidate !== '..' && !candidate.startsWith('..' + sep));
}

export function requiredSkillPackages(harnessRoot) {
  const config = JSON.parse(readFileSync(resolve(harnessRoot, 'ai/harness.json'), 'utf8'));
  return config.skills.map((skill) => ({
    name: skill.name,
    references: [...new Set(Object.values(skill.referenceRoutes || {}))].sort(),
  }));
}

export function requiredGlobalSkillPackages(harnessRoot) {
  const config = JSON.parse(readFileSync(resolve(harnessRoot, 'ai/harness.json'), 'utf8'));
  return (config.skillPackages || []).map((skillPackage) => ({
    source: skillPackage.source,
    installCommand: skillPackage.installCommand,
    requiredSkills: [...skillPackage.requiredSkills],
  }));
}

export function inspectHarnessPreflight({
  harnessRoot,
  repositoryPath,
  skillRoot,
  stateRoot,
  environment = process.env,
  sourceOnly = false,
  runner = spawnSync,
}) {
  const checks = [];
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  const nodeSupported = nodeMajor > 24 || (nodeMajor === 24 && nodeMinor >= 15);
  checks.push(
    result(
      nodeSupported ? 'ok' : 'error',
      'Node.js',
      process.versions.node,
      nodeSupported ? undefined : 'Install Node.js >=24.15 (the project uses Node 26).',
    ),
  );

  for (const [label, command, args, remediation] of [
    ['npm', 'npm', ['--version'], 'Install npm and make it available in PATH.'],
    ['Git', 'git', ['--version'], 'Install Git and make it available in PATH.'],
    [
      'OpenCode',
      environment.OPENCODE_BIN?.trim() || 'opencode',
      ['--version'],
      'Install OpenCode or set OPENCODE_BIN in the harness environment.',
    ],
  ]) {
    const commandResult = run(command, args, { cwd: harnessRoot }, runner);
    checks.push(
      result(
        commandResult.ok ? 'ok' : 'error',
        label,
        commandResult.ok ? commandResult.output || 'available' : 'not available',
        commandResult.ok ? undefined : remediation,
      ),
    );
  }

  const dependenciesPresent = ['@modelcontextprotocol/sdk', 'zod'].every((dependency) =>
    existsSync(resolve(harnessRoot, 'node_modules', dependency, 'package.json')),
  );
  checks.push(
    result(
      dependenciesPresent ? 'ok' : 'error',
      'Harness dependencies',
      dependenciesPresent ? 'installed in the shared harness' : 'missing',
      dependenciesPresent ? undefined : 'Run npm ci in the harness repository.',
    ),
  );

  let globalPackages;
  try {
    globalPackages = requiredGlobalSkillPackages(harnessRoot);
  } catch (error) {
    checks.push(result('error', 'Global skill packages', error.message));
    globalPackages = [];
  }
  for (const skillPackage of globalPackages) {
    const missingSkills = skillPackage.requiredSkills.filter(
      (skill) => !existsSync(resolve(skillRoot, skill, 'SKILL.md')),
    );
    checks.push(
      result(
        missingSkills.length === 0 ? 'ok' : 'error',
        'Global skills ' + skillPackage.source,
        missingSkills.length === 0
          ? skillPackage.requiredSkills.length + ' required manifests present'
          : 'missing: ' + missingSkills.join(', '),
        missingSkills.length === 0 ? undefined : 'Install with: ' + skillPackage.installCommand,
      ),
    );
  }

  let skills;
  try {
    skills = requiredSkillPackages(harnessRoot);
  } catch (error) {
    checks.push(result('error', 'Skill allowlist', error.message));
    skills = [];
  }
  for (const skill of skills) {
    const manifest = resolve(skillRoot, skill.name, 'SKILL.md');
    const missingReferences = skill.references.filter(
      (reference) => !existsSync(resolve(skillRoot, skill.name, reference)),
    );
    const present = existsSync(manifest) && missingReferences.length === 0;
    checks.push(
      result(
        present ? 'ok' : 'error',
        'Skill ' + skill.name,
        present
          ? manifest + ' (' + skill.references.length + ' routed references checked)'
          : !existsSync(manifest)
            ? 'SKILL.md is missing under ' + skillRoot
            : 'missing references: ' + missingReferences.join(', '),
        present
          ? undefined
          : 'Install the complete ' + skill.name + ' package globally under ~/.agents/skills.',
      ),
    );
  }

  const modelConfigured = Boolean(environment.LOCAL_AI_BASE_URL?.trim());
  checks.push(
    result(
      modelConfigured ? 'ok' : 'error',
      'Local model configuration',
      modelConfigured ? 'endpoint configured (value hidden)' : 'LOCAL_AI_BASE_URL is missing',
      modelConfigured
        ? undefined
        : 'Create the ignored .env.local-ai file in the shared harness repository.',
    ),
  );

  let repositoryRoot;
  const gitRoot = run(
    'git',
    ['-C', resolve(repositoryPath), 'rev-parse', '--show-toplevel'],
    { cwd: harnessRoot },
    runner,
  );
  if (gitRoot.ok) {
    try {
      repositoryRoot = realpathSync(gitRoot.output);
    } catch {
      repositoryRoot = undefined;
    }
  }
  checks.push(
    result(
      repositoryRoot ? 'ok' : 'error',
      'Target Git repository',
      repositoryRoot || 'not a readable Git worktree: ' + resolve(repositoryPath),
      repositoryRoot ? undefined : 'Pass --repo with the path to an existing Git repository.',
    ),
  );

  if (repositoryRoot) {
    const status = run('git', ['status', '--porcelain'], { cwd: repositoryRoot }, runner);
    const clean = status.ok && status.output === '';
    checks.push(
      result(
        clean ? 'ok' : 'error',
        'Target checkout',
        clean ? 'clean; isolated runs can start from HEAD' : 'contains uncommitted changes',
        clean ? undefined : 'Commit or stash target changes before starting a harness run.',
      ),
    );
    for (const file of ['package.json', 'package-lock.json']) {
      const present = existsSync(resolve(repositoryRoot, file));
      checks.push(
        result(
          present ? 'ok' : 'error',
          'Target ' + file,
          present ? 'present' : 'missing',
          present
            ? undefined
            : 'The current angular-ionic-capacitor profile requires npm and ' + file + '.',
        ),
      );
    }
    const resolvedStateRoot = resolve(stateRoot);
    const separated =
      !contains(repositoryRoot, resolvedStateRoot) && !contains(resolvedStateRoot, repositoryRoot);
    checks.push(
      result(
        separated ? 'ok' : 'error',
        'External state root',
        separated ? resolvedStateRoot + ' (outside target)' : 'overlaps the target repository',
        separated ? undefined : 'Choose an IONA_STATE_ROOT outside the target repository.',
      ),
    );
  }

  if (sourceOnly) {
    checks.push(
      result(
        'warn',
        'Docker Executor',
        'not checked (--source-only)',
        'Run doctor without --source-only before coding.',
      ),
    );
  } else {
    const docker = run(
      'docker',
      ['info', '--format', '{{.ServerVersion}}'],
      { cwd: harnessRoot },
      runner,
    );
    checks.push(
      result(
        docker.ok ? 'ok' : 'error',
        'Docker Executor',
        docker.ok ? 'daemon ' + (docker.output || 'available') : 'daemon unavailable',
        docker.ok
          ? undefined
          : 'Install/start Docker and run npm run agent:docker:build in the harness repository.',
      ),
    );
  }

  return checks;
}
