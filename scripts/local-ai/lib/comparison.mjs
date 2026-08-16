function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function percentage(value) {
  return Math.round(value * 1000) / 10 + '%';
}

function duration(value) {
  return value === null || value === undefined ? '—' : (value / 1000).toFixed(1) + ' s';
}

function providerMarkup(report) {
  const summary = report.summary;
  return `<article class="provider"><p class="eyebrow">${escapeHtml(report.metadata.provider)}</p><h2>${escapeHtml(report.metadata.model)}</h2><div class="score">${percentage(summary.qualityScore)}</div><p>weighted quality</p><dl><div><dt>Pass rate</dt><dd>${percentage(summary.passRate)}</dd></div><div><dt>Correctness</dt><dd>${percentage(summary.correctnessRate)}</dd></div><div><dt>Safety</dt><dd>${percentage(summary.safetyRate)}</dd></div><div><dt>Grounding</dt><dd>${percentage(summary.groundingRate)}</dd></div><div><dt>Optimality</dt><dd>${percentage(summary.optimalityScore)}</dd></div><div><dt>Average attempts</dt><dd>${summary.averageAttempts ?? '—'}</dd></div><div><dt>Average length</dt><dd>${summary.averageWords ?? '—'} words</dd></div><div><dt>Average latency</dt><dd>${duration(summary.averageLatencyMs)}</dd></div></dl></article>`;
}

function runMetric(run, type) {
  const checks =
    run.response?.checks?.filter((check) =>
      type === 'contains'
        ? ['contains', 'contains-any'].includes(check.type)
        : type === 'not-contains'
          ? ['not-contains', 'not-matches'].includes(check.type)
          : check.type === type,
    ) ?? [];
  return checks.length ? checks.filter((check) => check.passed).length / checks.length : 0;
}

function groundingMetric(run) {
  const checks = run.grounding?.checks ?? [];
  return checks.length ? checks.filter((check) => check.passed).length / checks.length : 0;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function renderComparisonReport(comparison) {
  const providers = [comparison.local, comparison.codex];
  const taskIds = [...new Set(providers.flatMap((report) => report.runs.map((run) => run.taskId)))];
  const rows = taskIds
    .flatMap((taskId) =>
      providers.map((report) => {
        const runs = report.runs.filter((run) => run.taskId === taskId);
        const passed = runs.filter((run) => run.passed).length;
        return `<tr><td><code>${escapeHtml(taskId)}</code></td><td>${escapeHtml(report.metadata.provider)}</td><td class="${passed === runs.length ? 'good' : 'bad'}">${passed}/${runs.length}</td><td>${percentage(average(runs.map((run) => runMetric(run, 'contains'))))}</td><td>${percentage(average(runs.map((run) => runMetric(run, 'not-contains'))))}</td><td>${percentage(average(runs.map(groundingMetric)))}</td><td>${average(runs.map((run) => run.attempts ?? 1)).toFixed(1)}</td><td>${Math.round(average(runs.map((run) => run.wordCount ?? 0)))}</td><td>${duration(average(runs.map((run) => run.latencyMs ?? 0)))}</td></tr>`;
      }),
    )
    .join('');
  const localFailures = comparison.local.runs
    .filter((run) => !run.passed)
    .map((run) => run.taskId)
    .filter((value, index, values) => values.indexOf(value) === index);
  const faster =
    comparison.local.summary.averageLatencyMs <= comparison.codex.summary.averageLatencyMs
      ? comparison.local
      : comparison.codex;
  const higherQuality =
    comparison.local.summary.qualityScore >= comparison.codex.summary.qualityScore
      ? comparison.local
      : comparison.codex;
  const speedRatio =
    comparison.local.summary.averageLatencyMs / comparison.codex.summary.averageLatencyMs;
  const wordDifference =
    comparison.local.summary.averageWords - comparison.codex.summary.averageWords;
  const passDifference = Math.round(
    (comparison.codex.summary.passRate - comparison.local.summary.passRate) * 100,
  );
  const repairRuns = comparison.local.runs.filter((run) => (run.attempts ?? 1) > 1).length;
  const locallyFasterTasks = taskIds.filter((taskId) => {
    const local = comparison.local.runs.find((run) => run.taskId === taskId);
    const codex = comparison.codex.runs.find((run) => run.taskId === taskId);
    return local && codex && local.latencyMs < codex.latencyMs;
  }).length;

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Harness model comparison</title><style>
:root{color-scheme:dark;--bg:#080b10;--panel:#101722;--line:#273246;--text:#eef4ff;--muted:#91a0b7;--blue:#79aaff;--green:#53d49e;--red:#ff7487}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% 0,#182947 0,transparent 34%),var(--bg);color:var(--text);font:15px/1.55 system-ui,sans-serif}main{width:min(1240px,calc(100% - 30px));margin:auto;padding:52px 0 80px}.eyebrow{color:var(--blue);font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin:0}h1{font-size:clamp(38px,6vw,70px);line-height:1.02;margin:8px 0 18px;max-width:900px}h2{margin:6px 0}.lead{color:var(--muted);max-width:820px}.providers{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:30px 0}.provider{border:1px solid var(--line);background:linear-gradient(145deg,#131b29,#0d131d);border-radius:18px;padding:24px}.score{font-size:52px;font-weight:850;color:var(--green)}dl{display:grid;grid-template-columns:1fr 1fr;gap:10px}dl div{border-top:1px solid var(--line);padding-top:9px}dt{color:var(--muted)}dd{margin:2px 0;font-weight:700}.analysis{border:1px solid var(--line);border-radius:16px;padding:18px 22px;background:#0d141f}.analysis strong{color:var(--green)}.table-wrap{overflow:auto;margin-top:28px;border:1px solid var(--line);border-radius:16px}table{border-collapse:collapse;width:100%;min-width:900px;background:#0c121b}th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.good{color:var(--green);font-weight:800}.bad{color:var(--red);font-weight:800}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.note{color:var(--muted);font-size:13px;margin-top:24px}@media(max-width:760px){.providers{grid-template-columns:1fr}dl{grid-template-columns:1fr 1fr}}
</style></head><body><main><p class="eyebrow">Practical benchmark</p><h1>gpt-oss-20b vs Codex</h1><p class="lead">Одинаковые frozen tasks, skill scope и детерминированные проверки. Корректность имеет больший вес, чем краткость или скорость.</p><section class="providers">${providers.map(providerMarkup).join('')}</section><section class="analysis"><p>Быстрее в среднем: <strong>${escapeHtml(faster.metadata.provider)}</strong>. Codex завершал запрос в среднем в <strong>${speedRatio.toFixed(2)}×</strong> быстрее, был на <strong>${Math.abs(wordDifference)}</strong> слов ${wordDifference > 0 ? 'короче' : 'длиннее'} и получил преимущество <strong>${passDifference} п.п.</strong> по pass rate.</p><p>Локальная модель потребовала repair в <strong>${repairRuns}/${comparison.local.runs.length}</strong> задач и была быстрее Codex в <strong>${locallyFasterTasks}/${taskIds.length}</strong>. Выше weighted quality: <strong>${escapeHtml(higherQuality.metadata.provider)}</strong>.</p><p>Не пройденные локальной моделью задачи: ${localFailures.length ? localFailures.map((id) => `<code>${escapeHtml(id)}</code>`).join(', ') : '<strong>нет</strong>'}. Высокий средний quality score не заменяет per-task gate: один невалидный Angular template должен блокировать результат.</p></section><div class="table-wrap"><table><thead><tr><th>Task</th><th>Provider</th><th>Pass</th><th>Correctness</th><th>Safety</th><th>Grounding</th><th>Attempts</th><th>Words</th><th>Latency</th></tr></thead><tbody>${rows}</tbody></table></div><p class="note">Это read-only benchmark практических инженерных ответов, а не benchmark применения patch/build. Weighted quality = 60% required facts + 25% safety + 15% cited-source grounding. Optimality applies a length penalty only above 450 words. Local evaluation may use one bounded repair attempt and reports its latency; Codex is measured one-shot. Latency includes the complete provider request; Codex may additionally load skills with tools. Prompts, hidden reasoning, credentials, endpoint URLs and project files are excluded.</p></main></body></html>`;
}
