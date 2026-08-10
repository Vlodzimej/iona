import assert from 'node:assert/strict';
import test from 'node:test';
import { globMatches, pathAccess, pathsFromPatch } from '../lib/policy.mjs';

const config = {
  allowedWritePatterns: ['src/**'],
  protectedWritePatterns: ['package.json', 'android/**'],
  deniedPatterns: ['.env*', '**/.env*', '.git/**', '**/*.key'],
};

test('glob matching supports exact, single-star, and double-star patterns', () => {
  assert.equal(globMatches('src/app/page.ts', 'src/**'), true);
  assert.equal(globMatches('src/app/page.ts', 'src/*.ts'), false);
  assert.equal(globMatches('package.json', 'package.json'), true);
  assert.equal(globMatches('src/a.ts', 'src/?.ts'), true);
  assert.equal(globMatches('src/ab.ts', 'src/?.ts'), false);
  assert.equal(globMatches('private.key', '**/*.key'), true);
  assert.equal(globMatches('config/private.key', '**/*.key'), true);
});

test('write policy separates allowed, protected, and denied paths', () => {
  assert.deepEqual(pathAccess(config, 'src/app/page.ts', { write: true }).allowed, true);
  assert.equal(pathAccess(config, 'package.json', { write: true }).reason, 'approval_required');
  assert.equal(
    pathAccess(config, 'package.json', { write: true, allowProtected: true }).allowed,
    true,
  );
  assert.equal(pathAccess(config, '.env.local', { write: true }).reason, 'denied');
  assert.equal(pathAccess(config, 'feature/.envlocal', { write: true }).reason, 'denied');
  assert.equal(pathAccess(config, 'private.key').reason, 'denied');
  assert.equal(pathAccess(config, '.ENV.LOCAL').reason, 'denied');
  assert.throws(() => pathAccess(config, '../outside', { write: true }), /traversal/u);
});

test('patch parser accepts normal diffs and rejects traversal, rename, and symlink patches', () => {
  const patch = [
    'diff --git a/src/app/a.ts b/src/app/a.ts',
    '--- a/src/app/a.ts',
    '+++ b/src/app/a.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
  assert.deepEqual(pathsFromPatch(patch), ['src/app/a.ts']);
  assert.throws(
    () =>
      pathsFromPatch(
        'diff --git a/../secret b/../secret\n--- a/../secret\n+++ b/../secret\n@@ -0,0 +1 @@\n+x',
      ),
    /traversal/u,
  );
  assert.throws(() => pathsFromPatch('diff --git a/src/a.ts b/src/b.ts'), /Renames/u);
  assert.throws(
    () => pathsFromPatch('diff --git a/src/link b/src/link\nnew file mode 120000'),
    /symbolic links/u,
  );
  assert.throws(
    () =>
      pathsFromPatch(
        'diff --git a/src/vendor b/src/vendor\nindex aaaaaaa..bbbbbbb 160000\n--- a/src/vendor\n+++ b/src/vendor',
      ),
    /submodules/u,
  );
  assert.throws(
    () => pathsFromPatch('diff --git a/src/tool.ts b/src/tool.ts\nnew file mode 100755'),
    /100644/u,
  );
  assert.deepEqual(
    pathsFromPatch(
      'diff --git a/src/app/a.ts b/src/app/a.ts\n--- a/src/app/a.ts\n+++ b/src/app/a.ts\n@@ -1 +1,2 @@\n old\n+new mode 100755',
    ),
    ['src/app/a.ts'],
  );
});
