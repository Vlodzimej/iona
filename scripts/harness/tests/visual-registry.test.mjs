import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { registerRepository } from '../lib/registry.mjs';
import {
  isAllowedVisualRequest,
  listVisualAssets,
  normalizeLoopbackUrl,
  registerVisualBaseline,
  registerVisualTarget,
  resolveVisualBaseline,
} from '../lib/visual-registry.mjs';

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

test('visual registry accepts only loopback targets and normalizes immutable PNG baselines', () => {
  const targetRoot = mkdtempSync(resolve(tmpdir(), 'ionic-visual-target-'));
  const stateRoot = mkdtempSync(resolve(tmpdir(), 'ionic-visual-state-'));
  try {
    git(targetRoot, 'init', '-b', 'main');
    git(targetRoot, 'config', 'user.name', 'Visual Test');
    git(targetRoot, 'config', 'user.email', 'visual@example.invalid');
    writeFileSync(resolve(targetRoot, 'README.md'), 'fixture\n');
    git(targetRoot, 'add', '.');
    git(targetRoot, 'commit', '-m', 'fixture');
    const repository = registerRepository(stateRoot, targetRoot);
    const target = registerVisualTarget(stateRoot, repository.id, {
      name: 'local-app',
      url: 'http://127.0.0.1:4200/page#private-fragment',
    });
    assert.match(target.id, /^local-app-[a-f0-9]{12}$/u);
    assert.throws(
      () => registerVisualTarget(stateRoot, repository.id, { url: 'https://example.com' }),
      /loopback/u,
    );
    assert.throws(() => normalizeLoopbackUrl('http://user:secret@localhost:4200'), /credentials/u);
    assert.equal(isAllowedVisualRequest('http://localhost:4200/assets/app.js'), true);
    assert.equal(isAllowedVisualRequest('https://cdn.example.com/font.woff2'), false);
    assert.equal(
      isAllowedVisualRequest('ws://localhost:4200/hmr', 'http://localhost:4200/application'),
      true,
    );
    assert.equal(
      isAllowedVisualRequest('http://localhost:7331/private', 'http://localhost:4200'),
      false,
    );

    const oversizedHeader = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversizedHeader);
    oversizedHeader.write('IHDR', 12, 'ascii');
    oversizedHeader.writeUInt32BE(100_000, 16);
    oversizedHeader.writeUInt32BE(100_000, 20);
    const oversizedPath = resolve(stateRoot, 'oversized.png');
    writeFileSync(oversizedPath, oversizedHeader);
    assert.throws(
      () =>
        registerVisualBaseline(stateRoot, repository.id, {
          name: 'oversized',
          imagePath: oversizedPath,
        }),
      /16 megapixel/u,
    );

    const image = new PNG({ width: 4, height: 3 });
    image.data.fill(255);
    const source = resolve(targetRoot, 'baseline.png');
    writeFileSync(source, PNG.sync.write(image));
    const baseline = registerVisualBaseline(stateRoot, repository.id, {
      name: 'home',
      imagePath: source,
    });
    assert.equal(baseline.width, 4);
    assert.equal(baseline.height, 3);
    const resolved = resolveVisualBaseline(stateRoot, repository.id, baseline.id);
    assert.equal(statSync(resolved.path).mode & 0o777, 0o600);
    assert.doesNotMatch(resolved.path, new RegExp(targetRoot, 'u'));
    assert.doesNotThrow(() => PNG.sync.read(readFileSync(resolved.path)));
    assert.deepEqual(
      listVisualAssets(stateRoot, repository.id).targets.map(({ id }) => id),
      [target.id],
    );
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
});
