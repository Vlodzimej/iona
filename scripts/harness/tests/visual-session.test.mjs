import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { registerRepository } from '../lib/registry.mjs';
import {
  registerIosSimulatorTarget,
  registerVisualBaseline,
  registerVisualTarget,
} from '../lib/visual-registry.mjs';
import { VisualSessionManager } from '../lib/visual-session.mjs';

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

class FakeBrowser {
  async open() {
    return { fake: true };
  }

  async snapshot() {
    return {
      viewport: { width: 100, height: 80, deviceScaleFactor: 1 },
      document: { scrollWidth: 100, scrollHeight: 80 },
      nodes: [],
      truncated: false,
    };
  }

  async screenshot(_handle, path) {
    const image = new PNG({ width: 100, height: 80 });
    image.data.fill(255);
    writeFileSync(path, PNG.sync.write(image));
  }

  async close() {}
}

test('visual session keeps artifacts external and produces deterministic comparison and HTML', async () => {
  const targetRoot = mkdtempSync(resolve(tmpdir(), 'ionic-visual-session-target-'));
  const stateRoot = mkdtempSync(resolve(tmpdir(), 'ionic-visual-session-state-'));
  try {
    git(targetRoot, 'init', '-b', 'main');
    git(targetRoot, 'config', 'user.name', 'Visual Test');
    git(targetRoot, 'config', 'user.email', 'visual@example.invalid');
    writeFileSync(resolve(targetRoot, 'README.md'), 'fixture\n');
    git(targetRoot, 'add', '.');
    git(targetRoot, 'commit', '-m', 'fixture');
    const repository = registerRepository(stateRoot, targetRoot);
    const target = registerVisualTarget(stateRoot, repository.id, {
      name: 'app',
      url: 'http://localhost:4200',
    });
    const baselineImage = new PNG({ width: 100, height: 80 });
    baselineImage.data.fill(255);
    const baselinePath = resolve(stateRoot, 'expected.png');
    writeFileSync(baselinePath, PNG.sync.write(baselineImage));
    const baseline = registerVisualBaseline(stateRoot, repository.id, {
      name: 'expected',
      imagePath: baselinePath,
    });
    const manager = new VisualSessionManager({
      stateRoot,
      repositoryId: repository.id,
      browser: new FakeBrowser(),
    });
    const run = await manager.begin(target.id, 'desktop');
    const measured = await manager.measure(run.visualRunId);
    const comparison = await manager.compare(run.visualRunId, baseline.id);
    const report = await manager.report(run.visualRunId);
    assert.equal(measured.summary.passed, true);
    assert.equal(comparison.passed, true);
    assert.equal(comparison.mismatchPercent, 0);
    assert.equal(report.artifact, 'report.html');
    const state = manager.load(run.visualRunId);
    const reportPath = resolve(manager.runRoot(run.visualRunId), state.artifacts.report);
    const html = readFileSync(reportPath, 'utf8');
    assert.match(html, /Content-Security-Policy/u);
    assert.match(html, /data:image\/png;base64/u);
    assert.match(html, /Pixel threshold/u);
    assert.match(html, /100×80 @1/u);
    assert.doesNotMatch(html, /localhost:4200/u);
    assert.equal(
      execFileSync('git', ['status', '--porcelain'], { cwd: targetRoot, encoding: 'utf8' }),
      '',
    );
    await manager.finish(run.visualRunId);
    assert.equal(manager.status(run.visualRunId).status, 'completed');
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('screenshot-only native target creates an honest report without calling DOM snapshot', async () => {
  const targetRoot = mkdtempSync(resolve(tmpdir(), 'ionic-visual-native-target-'));
  const stateRoot = mkdtempSync(resolve(tmpdir(), 'ionic-visual-native-state-'));
  try {
    git(targetRoot, 'init', '-b', 'main');
    git(targetRoot, 'config', 'user.name', 'Visual Test');
    git(targetRoot, 'config', 'user.email', 'visual@example.invalid');
    writeFileSync(resolve(targetRoot, 'README.md'), 'fixture\n');
    git(targetRoot, 'add', '.');
    git(targetRoot, 'commit', '-m', 'fixture');
    const repository = registerRepository(stateRoot, targetRoot);
    const target = registerIosSimulatorTarget(stateRoot, repository.id, {
      name: 'ios',
      udid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
    });
    const browser = new FakeBrowser();
    browser.snapshot = async () => {
      throw new Error('DOM snapshot must not run.');
    };
    const manager = new VisualSessionManager({
      stateRoot,
      repositoryId: repository.id,
      browser,
    });
    const run = await manager.begin(target.id);
    const report = await manager.report(run.visualRunId);
    assert.equal(report.domInspection, 'unavailable');
    const html = readFileSync(
      resolve(manager.runRoot(run.visualRunId), manager.load(run.visualRunId).artifacts.report),
      'utf8',
    );
    assert.match(html, /DOM checks were skipped/u);
    assert.match(html, /ios-simulator/u);
    await manager.finish(run.visualRunId);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
});
