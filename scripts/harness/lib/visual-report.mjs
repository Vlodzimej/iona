import { readFileSync, writeFileSync } from 'node:fs';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function imageData(path) {
  if (!path) return '';
  return 'data:image/png;base64,' + readFileSync(path).toString('base64');
}

function card(title, path) {
  if (!path) return '';
  return `<figure><figcaption>${escapeHtml(title)}</figcaption><img alt="${escapeHtml(title)}" src="${imageData(path)}"></figure>`;
}

function violationRows(measurement) {
  return (measurement?.violations || [])
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.type)}</td><td><code>${escapeHtml(item.selector)}</code></td><td><code>${escapeHtml(item.relatedSelector || '')}</code></td><td><pre>${escapeHtml(JSON.stringify(item.details, null, 2))}</pre></td></tr>`,
    )
    .join('');
}

export function writeVisualReport(path, data) {
  const comparison = data.comparison;
  const measurement = data.measurement;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>Visual QA ${escapeHtml(data.runId)}</title><style>
:root{color-scheme:light;font:15px/1.5 system-ui,sans-serif;background:#f5f7fb;color:#182033}body{max-width:1400px;margin:auto;padding:24px}h1,h2{line-height:1.2}.summary,.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.metric,figure{background:white;border:1px solid #dfe4ee;border-radius:12px;padding:16px;box-shadow:0 2px 8px #14213d12}.metric strong{display:block;font-size:1.6rem}img{display:block;max-width:100%;height:auto;border:1px solid #dfe4ee}table{width:100%;border-collapse:collapse;background:white}th,td{padding:10px;border:1px solid #dfe4ee;text-align:left;vertical-align:top}code,pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}footer{margin-top:24px;color:#5b6475}
</style></head><body><h1>Visual QA report</h1>
<p>Run <code>${escapeHtml(data.runId)}</code> · target <code>${escapeHtml(data.targetId)}</code> · kind <code>${escapeHtml(data.targetKind || 'web')}</code> · profile <code>${escapeHtml(data.profileName)}</code></p>
<section class="summary">
<div class="metric"><span>Inspected nodes</span><strong>${escapeHtml(measurement?.inspectedNodes ?? 0)}</strong></div>
<div class="metric"><span>DOM violations</span><strong>${escapeHtml(measurement?.summary?.violations ?? 0)}</strong></div>
<div class="metric"><span>DOM inspection</span><strong>${escapeHtml(measurement?.skipped ? 'not available' : 'completed')}</strong></div>
<div class="metric"><span>Viewport</span><strong>${escapeHtml(measurement?.viewport ? `${measurement.viewport.width}×${measurement.viewport.height} @${measurement.viewport.deviceScaleFactor || 1}` : 'unknown')}</strong></div>
<div class="metric"><span>Mismatch</span><strong>${escapeHtml(comparison ? comparison.mismatchPercent + '%' : 'not compared')}</strong></div>
<div class="metric"><span>Pixel threshold</span><strong>${escapeHtml(comparison?.pixelThreshold ?? 'not compared')}</strong></div>
<div class="metric"><span>Maximum mismatch</span><strong>${escapeHtml(comparison ? comparison.maximumMismatchPercent + '%' : 'not compared')}</strong></div>
<div class="metric"><span>Result</span><strong>${escapeHtml(measurement?.summary?.passed && (!comparison || comparison.passed) ? 'PASS' : 'FAIL')}</strong></div>
</section>${measurement?.skipped ? `<p>DOM checks were skipped: ${escapeHtml(measurement.reason)}</p>` : ''}<h2>Images</h2><section class="gallery">
${card('Baseline', data.baselinePath)}${card('Actual', data.screenshotPath)}${card('Difference', data.diffPath)}
</section><h2>DOM violations</h2><table><thead><tr><th>Type</th><th>Selector</th><th>Related</th><th>Details</th></tr></thead><tbody>${violationRows(measurement)}</tbody></table>
<footer>Generated ${escapeHtml(new Date().toISOString())}. The report contains no target URL, input values, DOM text, credentials, or model reasoning.</footer></body></html>`;
  writeFileSync(path, html, { encoding: 'utf8', mode: 0o600 });
}
