# Optional Visual QA tools

The `ionic_visual_*` tools are an explicitly enabled, read-only visual observation layer. They do
not replace `ionic_harness_*` coding tools and never modify the target repository.

1. List human-registered targets and baselines; never invent their opaque IDs.
2. Start one visual run with a fixed device profile.
3. Use `dom_snapshot` only when raw bounded geometry is necessary. Prefer `measure` for defects.
4. Treat deterministic measurements and comparison thresholds as evidence. Do not claim that raw
   images were visually understood by a text-only model.
5. Generate a report when the user needs reviewable evidence, then finish the visual run.
6. Never request arbitrary URLs, filesystem paths, browser scripting, device access, or shell access.
