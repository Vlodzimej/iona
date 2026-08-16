import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { registerRepository } from '../lib/registry.mjs';
import { scoreVisualDetections } from '../lib/visual-analysis.mjs';
import { registerVisualBaseline, registerVisualTarget } from '../lib/visual-registry.mjs';
import { VisualSessionManager } from '../lib/visual-session.mjs';

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

function page(defective) {
  const cells = Array.from(
    { length: 320 },
    (_, index) => `<span class="cell">${index}</span>`,
  ).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}.stage{width:1100px;padding:20px}.controls{display:flex;gap:16px;align-items:start;height:70px}
#small{width:${defective ? 32 : 48}px;height:${defective ? 36 : 48}px}#unnamed,#named-input{width:48px;height:48px}
#overflow{position:relative;width:100px;height:50px;overflow:hidden;background:#eee}#wide{width:${defective ? 170 : 90}px;height:40px;background:#8ecae6}
.overlap-stage{position:relative;width:220px;height:100px;margin-top:16px}.box{position:absolute;width:80px;height:60px}.a{left:0;top:0;background:#ffb703}.b{left:${defective ? 40 : 100}px;top:20px;background:#fb8500}
.shadow-stage{height:64px}shadow-card{display:block;width:60px;height:60px}
.grid{display:grid;grid-template-columns:repeat(20,40px);gap:2px;margin-top:12px}.cell{display:block;width:40px;height:20px;background:#edf2f4;font-size:10px}
</style></head><body><main class="stage"><section class="controls">
<button id="small">S</button><button id="unnamed"${defective ? '' : ' aria-label="Menu"'}></button><label for="named-input">Name</label><input id="named-input">
<div id="overflow"><div id="wide"></div></div></section>
<section class="overlap-stage"><div id="overlap-a" class="box a"></div><div id="overlap-b" class="box b"></div></section>
<section class="shadow-stage"><shadow-card></shadow-card></section>
<section class="grid">${cells}</section></main><script>
customElements.define('shadow-card',class extends HTMLElement{connectedCallback(){const root=this.attachShadow({mode:'open'});root.innerHTML='<button id="shadow-small" style="width:${defective ? 32 : 48}px;height:${defective ? 36 : 48}px">Shadow</button>'}})
</script></body></html>`;
}

async function listen(server) {
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  return server.address().port;
}

test(
  'real browser DOM evaluation reaches useful accuracy and bounded latency',
  { skip: process.env.npm_lifecycle_event !== 'harness:visual:test' },
  async (context) => {
    let defective = false;
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page(defective));
    });
    const port = await listen(server);
    context.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));
    const targetRoot = mkdtempSync(resolve(tmpdir(), 'ionic-visual-browser-target-'));
    const stateRoot = mkdtempSync(resolve(tmpdir(), 'ionic-visual-browser-state-'));
    context.after(() => {
      rmSync(targetRoot, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    });
    git(targetRoot, 'init', '-b', 'main');
    git(targetRoot, 'config', 'user.name', 'Visual Browser Test');
    git(targetRoot, 'config', 'user.email', 'visual@example.invalid');
    writeFileSync(resolve(targetRoot, 'README.md'), 'fixture\n');
    git(targetRoot, 'add', '.');
    git(targetRoot, 'commit', '-m', 'fixture');
    const repository = registerRepository(stateRoot, targetRoot);
    const target = registerVisualTarget(stateRoot, repository.id, {
      name: 'fixture',
      url: `http://127.0.0.1:${port}`,
    });
    const manager = new VisualSessionManager({ stateRoot, repositoryId: repository.id });
    context.after(() => manager.shutdown());

    const baselineRun = await manager.begin(target.id, 'desktop');
    await manager.screenshot(baselineRun.visualRunId);
    const baselineState = manager.load(baselineRun.visualRunId);
    const baseline = registerVisualBaseline(stateRoot, repository.id, {
      name: 'fixture-clean',
      imagePath: resolve(
        manager.runRoot(baselineRun.visualRunId),
        baselineState.artifacts.screenshot,
      ),
    });
    await manager.finish(baselineRun.visualRunId);

    defective = true;
    const run = await manager.begin(target.id, 'desktop');
    const measurement = await manager.measure(run.visualRunId);
    const byId = (id) => {
      const node = manager.load(run.visualRunId).artifacts.domSnapshot;
      assert.ok(node);
      const snapshot = JSON.parse(
        readFileSync(resolve(manager.runRoot(run.visualRunId), node), 'utf8'),
      );
      return snapshot.nodes.find((item) => item.selector.includes(`#${id}`))?.selector;
    };
    const small = byId('small');
    const unnamed = byId('unnamed');
    const overflow = byId('overflow');
    const wide = byId('wide');
    const overlapA = byId('overlap-a');
    const overlapB = byId('overlap-b');
    const shadowSmall = byId('shadow-small');
    const expected = [
      { type: 'touch-target', selector: small },
      { type: 'accessible-name', selector: unnamed },
      { type: 'content-overflow-x', selector: overflow },
      { type: 'clipped-by-ancestor', selector: wide },
      { type: 'overlap', selector: overlapA, relatedSelector: overlapB },
      { type: 'touch-target', selector: shadowSmall },
    ];
    const score = scoreVisualDetections(expected, measurement.violations);
    const comparison = await manager.compare(run.visualRunId, baseline.id, {
      maximumMismatchPercent: 0.01,
    });
    const report = await manager.report(run.visualRunId);

    context.diagnostic(
      JSON.stringify({
        inspectedNodes: measurement.inspectedNodes,
        measurementDurationMs: measurement.durationMs,
        score,
        mismatchPercent: comparison.mismatchPercent,
      }),
    );

    assert.ok(measurement.inspectedNodes >= 330, `inspected ${measurement.inspectedNodes} nodes`);
    assert.ok(measurement.durationMs < 2_000, `measurement took ${measurement.durationMs}ms`);
    assert.ok(
      score.precision >= 0.9,
      JSON.stringify({ score, violations: measurement.violations }, null, 2),
    );
    assert.equal(
      score.recall,
      1,
      JSON.stringify({ score, violations: measurement.violations }, null, 2),
    );
    assert.ok(score.f1 >= 0.94, JSON.stringify(score));
    assert.equal(comparison.passed, false);
    assert.ok(comparison.mismatchPercent > 0.01);
    assert.equal(report.artifact, 'report.html');
    await manager.finish(run.visualRunId);
  },
);
