import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { createRunId } from '../../agent/lib/worktree.mjs';
import { secureJsonWrite } from './store.mjs';
import { analyzeDomSnapshot } from './visual-analysis.mjs';
import { visualDeviceProfiles } from './visual-browser.mjs';
import { VisualTargetAdapter } from './visual-native.mjs';
import {
  listVisualAssets,
  resolveVisualBaseline,
  resolveVisualTarget,
  visualRunsRoot,
} from './visual-registry.mjs';
import { writeVisualReport } from './visual-report.mjs';

const runIdPattern = /^[a-zA-Z0-9-]+$/u;
const maximumScreenshotBytes = 20 * 1024 * 1024;
const maximumScreenshotPixels = 16_000_000;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function rounded(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function publicState(state) {
  return {
    ok: state.status !== 'failed',
    repositoryId: state.repositoryId,
    visualRunId: state.visualRunId,
    targetId: state.targetId,
    targetKind: state.targetKind || 'web',
    capabilities: [...(state.capabilities || ['dom', 'screenshot'])],
    profileName: state.profileName,
    status: state.status,
    artifacts: { ...state.artifacts },
    error: state.error || null,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

function writeArtifact(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}

function validatedScreenshot(path) {
  const image = readFileSync(path);
  if (
    image.byteLength < 24 ||
    image.byteLength > maximumScreenshotBytes ||
    !image.subarray(0, pngSignature.byteLength).equals(pngSignature) ||
    image.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('Visual adapter returned an invalid or oversized PNG screenshot.');
  }
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (!width || !height || width * height > maximumScreenshotPixels) {
    throw new Error('Visual screenshot exceeds the 16 megapixel limit.');
  }
  return image;
}

export class VisualSessionManager {
  constructor({ stateRoot, repositoryId, browser = new VisualTargetAdapter() }) {
    this.stateRoot = stateRoot;
    this.repositoryId = repositoryId;
    this.runsRoot = visualRunsRoot(stateRoot, repositoryId);
    this.browser = browser;
    this.handles = new Map();
  }

  assets() {
    return listVisualAssets(this.stateRoot, this.repositoryId);
  }

  runRoot(visualRunId) {
    if (!runIdPattern.test(visualRunId)) throw new Error('Invalid visual run ID.');
    return resolve(this.runsRoot, visualRunId);
  }

  save(state) {
    const root = this.runRoot(state.visualRunId);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    state.updatedAt = new Date().toISOString();
    secureJsonWrite(resolve(root, 'state.json'), state);
    return state;
  }

  load(visualRunId) {
    const path = resolve(this.runRoot(visualRunId), 'state.json');
    if (!existsSync(path)) throw new Error('Visual run does not exist: ' + visualRunId + '.');
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (
      state.schemaVersion !== 1 ||
      state.visualRunId !== visualRunId ||
      state.repositoryId !== this.repositoryId
    ) {
      throw new Error('Unsupported or mismatched visual run state.');
    }
    return state;
  }

  requireActive(visualRunId) {
    const state = this.load(visualRunId);
    if (state.status !== 'active') throw new Error('Visual run is not active.');
    const handle = this.handles.get(visualRunId);
    if (!handle) {
      throw new Error('Visual browser session is no longer available; start a new visual run.');
    }
    return { state, handle };
  }

  async begin(targetId, profileName) {
    const target = resolveVisualTarget(this.stateRoot, this.repositoryId, targetId);
    const effectiveProfile = profileName || (target.kind === 'web' ? 'desktop' : 'native');
    if (
      (target.kind === 'web' && !visualDeviceProfiles[effectiveProfile]) ||
      (target.kind !== 'web' && effectiveProfile !== 'native')
    ) {
      throw new Error(
        'Visual device profile is incompatible with target kind ' + target.kind + '.',
      );
    }
    const visualRunId = 'visual-' + createRunId();
    const createdAt = new Date().toISOString();
    const state = {
      schemaVersion: 1,
      repositoryId: this.repositoryId,
      visualRunId,
      targetId,
      targetKind: target.kind,
      capabilities: target.capabilities,
      profileName: effectiveProfile,
      status: 'starting',
      artifacts: {},
      comparison: null,
      error: null,
      createdAt,
      updatedAt: createdAt,
    };
    this.save(state);
    try {
      const handle = await this.browser.open(target, effectiveProfile);
      this.handles.set(visualRunId, handle);
      state.status = 'active';
      this.save(state);
      return publicState(state);
    } catch (error) {
      state.status = 'failed';
      state.error = error instanceof Error ? error.message : String(error);
      this.save(state);
      throw error;
    }
  }

  status(visualRunId) {
    return publicState(this.load(visualRunId));
  }

  async snapshot(visualRunId, maximumNodes = 500) {
    const { state, handle } = this.requireActive(visualRunId);
    if (!(state.capabilities || ['dom', 'screenshot']).includes('dom')) {
      throw new Error('DOM inspection is not available for this visual target.');
    }
    const started = performance.now();
    const snapshot = await this.browser.snapshot(handle, maximumNodes);
    snapshot.durationMs = rounded(performance.now() - started);
    const filename = 'dom-snapshot.json';
    writeArtifact(resolve(this.runRoot(visualRunId), filename), snapshot);
    state.artifacts.domSnapshot = filename;
    this.save(state);
    return {
      ok: true,
      visualRunId,
      artifact: filename,
      durationMs: snapshot.durationMs,
      viewport: snapshot.viewport,
      document: snapshot.document,
      inspectedNodes: snapshot.nodes.length,
      truncated: snapshot.truncated,
      nodes: snapshot.nodes,
    };
  }

  async measure(visualRunId, rules = {}) {
    const { state, handle } = this.requireActive(visualRunId);
    if (!(state.capabilities || ['dom', 'screenshot']).includes('dom')) {
      throw new Error('DOM measurement is not available for this visual target.');
    }
    const started = performance.now();
    const snapshot = await this.browser.snapshot(handle, 500);
    const measurement = analyzeDomSnapshot(snapshot, rules);
    measurement.durationMs = rounded(performance.now() - started);
    const snapshotFilename = 'dom-snapshot.json';
    const measurementFilename = 'measurements.json';
    writeArtifact(resolve(this.runRoot(visualRunId), snapshotFilename), snapshot);
    writeArtifact(resolve(this.runRoot(visualRunId), measurementFilename), measurement);
    state.artifacts.domSnapshot = snapshotFilename;
    state.artifacts.measurements = measurementFilename;
    this.save(state);
    return { ok: true, visualRunId, artifact: measurementFilename, ...measurement };
  }

  async screenshot(visualRunId) {
    const { state, handle } = this.requireActive(visualRunId);
    const filename = 'actual.png';
    const path = resolve(this.runRoot(visualRunId), filename);
    const started = performance.now();
    await this.browser.screenshot(handle, path);
    const image = validatedScreenshot(path);
    chmodSync(path, 0o600);
    state.artifacts.screenshot = filename;
    this.save(state);
    return {
      ok: true,
      visualRunId,
      artifact: filename,
      durationMs: rounded(performance.now() - started),
      sha256: createHash('sha256').update(image).digest('hex'),
    };
  }

  async compare(visualRunId, baselineId, options = {}) {
    let { state } = this.requireActive(visualRunId);
    if (!state.artifacts.screenshot) {
      await this.screenshot(visualRunId);
      state = this.load(visualRunId);
    }
    const baseline = resolveVisualBaseline(this.stateRoot, this.repositoryId, baselineId);
    const screenshotPath = resolve(this.runRoot(visualRunId), state.artifacts.screenshot);
    const actual = PNG.sync.read(readFileSync(screenshotPath), { skipRescale: true });
    const expected = PNG.sync.read(readFileSync(baseline.path), { skipRescale: true });
    const maximumMismatchPercent = options.maximumMismatchPercent ?? 0.1;
    const pixelThreshold = options.pixelThreshold ?? 0.1;
    if (
      maximumMismatchPercent < 0 ||
      maximumMismatchPercent > 100 ||
      pixelThreshold < 0 ||
      pixelThreshold > 1
    ) {
      throw new Error('Visual comparison thresholds are out of range.');
    }
    const started = performance.now();
    let result;
    if (actual.width !== expected.width || actual.height !== expected.height) {
      result = {
        schemaVersion: 1,
        passed: false,
        sizeMismatch: true,
        expected: { width: expected.width, height: expected.height },
        actual: { width: actual.width, height: actual.height },
        mismatchPixels: null,
        mismatchPercent: 100,
        maximumMismatchPercent,
        pixelThreshold,
      };
    } else {
      const diff = new PNG({ width: actual.width, height: actual.height });
      const mismatchPixels = pixelmatch(
        expected.data,
        actual.data,
        diff.data,
        actual.width,
        actual.height,
        { threshold: pixelThreshold, alpha: 0.65, diffColor: [220, 38, 38] },
      );
      const mismatchPercent = rounded((mismatchPixels / (actual.width * actual.height)) * 100, 4);
      const diffFilename = 'difference.png';
      const diffPath = resolve(this.runRoot(visualRunId), diffFilename);
      writeFileSync(diffPath, PNG.sync.write(diff), { mode: 0o600 });
      chmodSync(diffPath, 0o600);
      state.artifacts.difference = diffFilename;
      result = {
        schemaVersion: 1,
        passed: mismatchPercent <= maximumMismatchPercent,
        sizeMismatch: false,
        expected: { width: expected.width, height: expected.height },
        actual: { width: actual.width, height: actual.height },
        mismatchPixels,
        mismatchPercent,
        maximumMismatchPercent,
        pixelThreshold,
      };
    }
    result.durationMs = rounded(performance.now() - started);
    result.baselineId = baselineId;
    const filename = 'comparison.json';
    writeArtifact(resolve(this.runRoot(visualRunId), filename), result);
    state.artifacts.comparison = filename;
    state.comparison = { baselineId, ...result };
    this.save(state);
    return { ok: true, visualRunId, artifact: filename, ...result };
  }

  async report(visualRunId) {
    const { state } = this.requireActive(visualRunId);
    if (
      !state.artifacts.measurements &&
      (state.capabilities || ['dom', 'screenshot']).includes('dom')
    ) {
      await this.measure(visualRunId);
    }
    if (!state.artifacts.screenshot) await this.screenshot(visualRunId);
    const root = this.runRoot(visualRunId);
    const refreshed = this.load(visualRunId);
    const measurement = refreshed.artifacts.measurements
      ? JSON.parse(readFileSync(resolve(root, refreshed.artifacts.measurements), 'utf8'))
      : {
          schemaVersion: 1,
          skipped: true,
          reason: 'DOM inspection is unavailable for this target.',
          inspectedNodes: 0,
          violations: [],
          summary: { passed: true, violations: 0 },
        };
    const comparison = refreshed.artifacts.comparison
      ? JSON.parse(readFileSync(resolve(root, refreshed.artifacts.comparison), 'utf8'))
      : null;
    const baseline = comparison
      ? resolveVisualBaseline(this.stateRoot, this.repositoryId, comparison.baselineId)
      : null;
    const filename = 'report.html';
    writeVisualReport(resolve(root, filename), {
      runId: visualRunId,
      targetId: refreshed.targetId,
      profileName: refreshed.profileName,
      targetKind: refreshed.targetKind,
      measurement,
      comparison,
      baselinePath: baseline?.path,
      screenshotPath: resolve(root, refreshed.artifacts.screenshot),
      diffPath: refreshed.artifacts.difference
        ? resolve(root, refreshed.artifacts.difference)
        : null,
    });
    refreshed.artifacts.report = filename;
    this.save(refreshed);
    return {
      ok: true,
      visualRunId,
      artifact: filename,
      summary: measurement.summary,
      domInspection: measurement.skipped ? 'unavailable' : 'completed',
      comparison: comparison
        ? { passed: comparison.passed, mismatchPercent: comparison.mismatchPercent }
        : null,
    };
  }

  async finish(visualRunId) {
    const { state, handle } = this.requireActive(visualRunId);
    await this.browser.close(handle);
    this.handles.delete(visualRunId);
    state.status = 'completed';
    this.save(state);
    return publicState(state);
  }

  async shutdown() {
    await Promise.allSettled(
      [...this.handles.entries()].map(async ([visualRunId, handle]) => {
        await this.browser.close(handle);
        this.handles.delete(visualRunId);
        const state = this.load(visualRunId);
        if (state.status === 'active') {
          state.status = 'interrupted';
          this.save(state);
        }
      }),
    );
  }
}
