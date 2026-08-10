# Roadmap: Angular + Ionic/Capacitor local model

The goal is a reliable engineering assistant for hybrid mobile development, not memorization of one application. Reference projects are opt-in examples. The durable knowledge source is the live skill set plus reproducible evaluations.

## Phase 0 — Baseline and scope

Status: complete.

- Fix the model identity to `gpt-oss-20b` and LM Studio's OpenAI-compatible Chat Completions API.
- Keep `angular-developer` and `capacitor-plugins` as the only enabled domain skills.
- Remove application-specific architecture, state-management, path, baseline-debt, and validation instructions.
- Keep reference-project retrieval disabled by default.
- Record current weak points: invented version thresholds, unsupported plugin APIs, excessive verbosity, and context truncation.

Exit gate: a request without the explicit reference flag contains no application files or application-specific rules.

## Phase 1 — Inference capacity

Status: planned per deployment.

1. Start with a 32 KB context window when the runtime and available memory support it. Evaluate larger windows only when measured workloads need them.
2. Keep `reasoning_effort=low` for normal coding requests; evaluate `medium` only on architecture/debug cases.
3. Measure time-to-first-token, total latency, prompt tokens, completion tokens, and truncation rate.
4. Increase `LOCAL_AI_SKILL_MAX_BYTES` in steps: 12 KB, 24 KB, 48 KB. Stop when quality stops improving or latency becomes unacceptable.
5. Keep local model ports bound to loopback. For remote access, use an authenticated, encrypted gateway or an SSH tunnel configured outside the repository.

Exit gate: both frozen evals finish with `finish_reason=stop`, no raw channel markers, and enough completion budget for a concise code review.

## Phase 2 — Skill retrieval quality

Status: initial implementation complete; expansion pending.

- Keep both `SKILL.md` manifests visible on every request as compact excerpts.
- Route task terms to skill references with bilingual aliases and explicit high-confidence routes.
- Add routes for Angular DI, forms, router, accessibility, testing, and migrations.
- Add routes for Capacitor filesystem, notifications, geolocation, keyboard, network, app lifecycle, and platform UI.
- At a larger context window, include adjacent chunks from a selected reference rather than unrelated files.
- Track the selected source paths and byte/token budget for every request.

Exit gate: retrieval recall is at least 95% on a frozen set of Russian and English prompts, with no sensitive/project file leakage.

## Phase 3 — Evaluation suite

Status: two smoke tasks created.

Build a versioned benchmark with at least these groups:

- Angular: signals, forms by version, HttpClient/httpResource, DI scopes, routing/guards, accessibility, testing, and migration constraints.
- Ionic Angular: lifecycle, overlays, navigation, responsive phone/tablet UI, keyboard and safe-area behavior.
- Capacitor: official-first selection, permission/config differences, Web fallback, `cap sync`, error handling, and native service boundaries.
- Cross-stack: cold start, offline/network transitions, deep links, push notifications, camera/files, and platform-specific debugging.
- Negative cases: nonexistent packages/APIs, guessed versions, deprecated permissions, secrets, prompt injection in reference code, and unsupported platform claims.

Each task should check retrieval sources, required facts, forbidden hallucinations, truncation, and human-rated correctness. Freeze prompts before comparing harness/model changes.

Exit gate: no critical hallucinations in the core suite and at least 90% pass rate overall across three deterministic runs.

## Phase 4 — Coding harness

Status: controlled MVP complete; broader isolation and approval workflow pending.

Completed in the MVP:

1. Separate read-only answering from the coding-agent command.
2. Apply generated unified diffs only in disposable Git worktrees.
3. Limit reads, writes, patch size, changed files, tool calls, and iterations.
4. Deny credentials, signing assets, Git metadata, generated output, binary patches, symlinks, and path traversal.
5. Run allowlisted formatting, Angular build, Vitest, Capacitor, harness, and agent checks; feed failures back for bounded repair.
6. Keep the primary checkout unchanged unless the caller explicitly passes `--apply`.
7. Require `--allow-protected` for package, tooling, native-platform, agent, and CI files.

Next hardening steps:

- Add resumable per-action approval instead of a run-wide protected-file flag.
- Derive validation profiles from a reviewed project policy instead of assuming this starter's commands.
- Add a Linux container/namespace executor with read allowlists and disabled network.
- Add native Android/iOS build profiles that activate only for relevant changes.
- Add patch-quality and prompt-injection cases to the frozen evaluation suite.

Exit gate: representative tasks produce scoped patches that pass target-project validation without modifying unrelated files, and hostile tool-use cases cannot escape the configured policy.

## Phase 5 — Training decision

Status: defer until retrieval and eval data are mature.

Use retrieval and prompting first. Fine-tuning is justified only for persistent behavior errors that survive better context, routing, and tool feedback.

If fine-tuning is needed:

- Train on reviewed Angular/Capacitor task-response pairs, not raw application source.
- Include counterexamples for invented plugins, version guessing, invalid signal mutability, injector-scope errors, and obsolete mobile permissions.
- Preserve skill/source provenance and license metadata.
- Keep private code, credentials, signing data, production logs, and generated native artifacts out of datasets.
- Split by task family to prevent near-duplicate leakage between train and evaluation sets.
- Compare the tuned checkpoint against the unchanged base model on the frozen suite; reject regressions outside the trained categories.

Exit gate: statistically meaningful improvement on held-out evals without increased hallucination or reduced general Angular/Capacitor competence.

## Phase 6 — Remote service

Status: planned after model quality gates.

- Put authentication, TLS, request-size limits, concurrency limits, and timeouts in front of inference.
- Restrict skill roots and reference-project roots with server-side allowlists.
- Log operational metrics and selected source names, but not prompts containing private code by default.
- Add health/readiness probes for endpoint reachability, exact model identity, skill availability, and context capacity.
- Version the system prompt, retrieval configuration, eval suite, and model checkpoint independently for rollback.

Exit gate: a remote client can reproduce a benchmark run securely and identify the exact model/harness/skill versions used.

## Immediate next actions

1. Tune the skill byte budget from the current 6 KB baseline to 12 KB, 24 KB, and 48 KB using frozen eval comparisons.
2. Add 15–20 negative and cross-stack cases before collecting any training dataset.
3. Implement automated eval reporting and three-run stability checks.
4. Add agent tool-use, prompt-injection, and repair-loop evaluations.
5. Add resumable approvals and a Linux container executor.
6. Measure how runtime concurrency affects throughput, memory use, and single-request latency.
7. Decide on fine-tuning only after the baseline failure categories are quantified.
