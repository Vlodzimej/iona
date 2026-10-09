# Optional Visual QA tools

The `ionic_visual_*` tools are an explicitly enabled, read-only visual observation layer. They do
not replace `iona_*` coding tools and never modify the target repository.

1. List human-registered targets and baselines; never invent their opaque IDs.
2. Select a target by its reported kind and capabilities. Use a fixed emulated profile for web and
   `native` for Android WebView, iOS Simulator, or Appium targets.
3. Use `dom_snapshot` only when the target reports `dom` and raw bounded geometry is necessary.
   Prefer `measure` for defects. A screenshot-only iOS Simulator target cannot provide DOM facts.
4. Treat deterministic measurements and comparison thresholds as evidence. Do not claim that raw
   images were visually understood by a text-only model.
5. Generate a report when the user needs reviewable evidence, then finish the visual run.
6. Never request arbitrary URLs, filesystem paths, browser scripting, device identifiers, Appium
   sessions, ADB/Xcode commands, or shell access. A human registers every connection detail.
