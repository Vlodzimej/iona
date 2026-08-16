import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  containerSkillRoot,
  normalizeSkillSourcePaths,
  runtimeSkillRoot,
  skillSourceRoot,
} from '../lib/env.mjs';

test('host runtime always resolves the user-scoped skill directory', () => {
  assert.equal(skillSourceRoot, '~/.agents/skills');
  assert.equal(runtimeSkillRoot({}), resolve(homedir(), '.agents/skills'));
});

test('host runtime rejects arbitrary skill root overrides', () => {
  assert.throws(
    () => runtimeSkillRoot({ LOCAL_AI_SKILL_ROOT: '/tmp/untrusted-skills' }),
    /reserved for the internal Docker mount/u,
  );
});

test('container runtime accepts only its fixed read-only mount path', () => {
  assert.equal(
    runtimeSkillRoot({
      LOCAL_AI_SKILLS_MOUNTED: '1',
      LOCAL_AI_SKILL_ROOT: containerSkillRoot,
    }),
    containerSkillRoot,
  );
  assert.throws(
    () =>
      runtimeSkillRoot({
        LOCAL_AI_SKILLS_MOUNTED: '1',
        LOCAL_AI_SKILL_ROOT: '/workspace/.agents/skills',
      }),
    /internal skill mount/u,
  );
});

test('visible answers normalize the concrete home skill path', () => {
  assert.equal(
    normalizeSkillSourcePaths(resolve(homedir(), '.agents/skills/angular-developer/SKILL.md')),
    '~/.agents/skills/angular-developer/SKILL.md',
  );
});
