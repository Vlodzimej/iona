import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { harnessRoot } from '../lib/paths.mjs';
import {
  inspectHarnessPreflight,
  requiredGlobalSkillPackages,
  requiredSkillPackages,
} from '../lib/preflight.mjs';

function successfulRunner(repositoryRoot) {
  return (command, args) => {
    if (command === 'git' && args[0] === '-C') {
      return { status: 0, stdout: repositoryRoot + '\n' };
    }
    if (command === 'git' && args[0] === 'status') {
      return { status: 0, stdout: '' };
    }
    if (command === 'docker') {
      return { status: 0, stdout: '29.0.0\n' };
    }
    return { status: 0, stdout: '1.0.0\n' };
  };
}

test('external project preflight checks configured skills without writing harness files', (context) => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'ionic-harness-preflight-'));
  const repositoryRoot = resolve(fixtureRoot, 'target');
  const skillRoot = resolve(fixtureRoot, 'skills');
  const stateRoot = resolve(fixtureRoot, 'state');
  mkdirSync(repositoryRoot, { recursive: true });
  writeFileSync(resolve(repositoryRoot, 'package.json'), '{}\n');
  writeFileSync(resolve(repositoryRoot, 'package-lock.json'), '{}\n');

  const requiredSkills = requiredSkillPackages(harnessRoot);
  const globalSkillNames = requiredGlobalSkillPackages(harnessRoot).flatMap(
    (skillPackage) => skillPackage.requiredSkills,
  );
  for (const skillName of new Set([
    ...requiredSkills.map((skill) => skill.name),
    ...globalSkillNames,
  ])) {
    const root = resolve(skillRoot, skillName);
    mkdirSync(root, { recursive: true });
    writeFileSync(resolve(root, 'SKILL.md'), '---\nname: ' + skillName + '\n---\n');
  }
  for (const skill of requiredSkills) {
    const root = resolve(skillRoot, skill.name);
    for (const reference of skill.references) {
      const path = resolve(root, reference);
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, '# Reference\n');
    }
  }
  context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  const checks = inspectHarnessPreflight({
    harnessRoot,
    repositoryPath: repositoryRoot,
    skillRoot,
    stateRoot,
    environment: { LOCAL_AI_BASE_URL: 'http://model.invalid/v1' },
    runner: successfulRunner(repositoryRoot),
  });

  assert.equal(
    checks.some((check) => check.level === 'error'),
    false,
  );
  assert.deepEqual(
    checks.filter((check) => check.label.startsWith('Skill ')).map((check) => check.label),
    [
      'Skill angular-developer',
      'Skill capacitor-plugins',
      'Skill ionic-native-essentials',
      'Skill ionic-deep-links',
    ],
  );
  assert.equal(checks.filter((check) => check.label.startsWith('Global skills ')).length, 3);
  assert.equal(checks.find((check) => check.label === 'External state root').level, 'ok');
  assert.equal(checks.find((check) => check.label === 'Target checkout').level, 'ok');
});

test('external project preflight reports missing skills and model configuration', (context) => {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'ionic-harness-preflight-missing-'));
  const repositoryRoot = resolve(fixtureRoot, 'target');
  mkdirSync(repositoryRoot, { recursive: true });
  writeFileSync(resolve(repositoryRoot, 'package.json'), '{}\n');
  writeFileSync(resolve(repositoryRoot, 'package-lock.json'), '{}\n');
  context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  const checks = inspectHarnessPreflight({
    harnessRoot,
    repositoryPath: repositoryRoot,
    skillRoot: resolve(fixtureRoot, 'skills'),
    stateRoot: resolve(fixtureRoot, 'state'),
    environment: {},
    sourceOnly: true,
    runner: successfulRunner(repositoryRoot),
  });

  assert.equal(checks.find((check) => check.label === 'Local model configuration').level, 'error');
  assert.equal(checks.find((check) => check.label === 'Skill angular-developer').level, 'error');
  assert.equal(checks.find((check) => check.label === 'Docker Executor').level, 'warn');
});
