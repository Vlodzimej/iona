# Angular Ionic Capacitor LLM Starter

A clean hybrid-mobile starter with a local-model harness and a controlled coding-agent runtime. The repository intentionally contains no product-specific architecture or business logic.

## Documentation

The connected Russian-language documentation portal explains the project from first principles, with an emphasis on the LLM harness, agent runtime, security boundaries, deployment hardening, and a step-by-step guide for building a similar environment:

- [Documentation home](docs/README.md)
- [Architecture](docs/architecture.md)
- [Harness](docs/harness/README.md)
- [Build your own harness](docs/build-your-own-harness.md)
- [Glossary](docs/glossary.md)
- [Overview presentation](docs/presentation/ionic-llm-harness-overview.pptx)

## Stack

- Angular 22.1 with standalone APIs, strict TypeScript 6, and Vitest.
- Ionic Angular 8.8 with standalone Ionic components.
- Capacitor 8.5 with Android and iOS packages installed but native projects not generated.
- Node 26 through `.nvmrc`; Angular 22 requires Node 24.15 or newer.
- `gpt-oss-20b` through an OpenAI-compatible model harness under `ai/`.

## Start

```bash
nvm use
npm ci
npm start
```

The blank application is available at `http://localhost:4200`.

## Validate

```bash
npm run verify
```

The verification pipeline checks documentation links and formatting, performs a production Angular build, runs Vitest, checks Capacitor, validates LocalAI skill routing, and tests the agent policy and protocol.

Individual commands:

```bash
npm run build
npm test -- --watch=false
npm run docs:check
npm run cap:doctor
npm run ai:doctor
npm run agent:doctor
npm run agent:test
```

Angular persistent disk cache is disabled for deterministic agent runs across attached environments.

## Native platforms

The platform packages are installed, while generated `android/` and `ios/` directories are intentionally absent from the blank repository. Add only the targets a project needs:

```bash
npx cap add android
npx cap add ios
npm run cap:sync
```

Commit generated native projects when they become part of the target application. Run `cap sync`, Gradle, CocoaPods, and Xcode only when a task requires native changes.

## Local-model harness

The harness loads these live skills for every request:

- `~/.agents/skills/angular-developer`
- `~/.agents/skills/capacitor-plugins`

Create the ignored local connection file and configure an OpenAI-compatible
endpoint:

```bash
cp .env.local-ai.example .env.local-ai
npm run ai:doctor
```

See `ai/remote-model.md` for direct, gateway, and optional tunnel connections.
Then:

```bash
npm run ai:smoke
npm run ai:context -- --query "Angular signal form in an Ionic page"
npm run ai:ask -- "Design an offline-aware Ionic Angular data flow"
```

Application files are not sent by default. Include this blank starter as untrusted example context only when needed:

```bash
npm run ai:ask -- --with-project-reference "Adapt the existing home page"
```

## Coding-agent runtime

The agent adds a bounded model/tool loop around the LLM harness. It can list,
search, and read allowed files, apply unified diffs, inspect Git changes, and
run versioned validation profiles. Every run starts from committed `HEAD` in a
disposable worktree under the ignored `.agent` directory.

The primary worktree must be clean. A normal run retains its isolated changes
for review and does not modify the primary checkout:

```bash
npm run agent:doctor
npm run agent -- "Add an accessible empty-state component to the home page"
```

Use `--apply` only when successful, fully validated changes should be copied
back to the still-clean primary worktree:

```bash
npm run agent -- "Add an accessible empty-state component" --apply
```

By default, writes are limited to application roots such as `src/`. Package,
tooling, native-platform, agent, and CI files are protected. A task that truly
requires them must be started with the explicit elevated flag:

```bash
npm run agent -- "Update the native camera integration" --allow-protected
```

Secret paths and Git metadata remain denied even in elevated mode. Validation
has no network access when the macOS process sandbox is available. On another
platform, run the agent inside an OS/container sandbox; host execution requires
an explicit opt-in through `LOCAL_AGENT_ALLOW_HOST_EXECUTION=1` or the
`--allow-host-execution` flag.

Run transcripts can contain task text, patches, and model output. They are
stored locally under `.agent/runs` with restricted file permissions and are
never committed.

## Repository layout

```text
ai/                  Model/agent policy, prompts, evaluations, and roadmap
scripts/local-ai/    Skill retrieval and OpenAI-compatible model client
scripts/agent/       Isolated worktrees, tool policy, agent loop, and tests
src/app/             Blank standalone Ionic Angular application
src/theme/           Shared Ionic design tokens
capacitor.config.ts  Provider-neutral Capacitor configuration
AGENTS.md             Rules for coding agents and local models
```

Use `ai/ROADMAP.md` for the staged plan covering retrieval quality, evaluations, coding worktrees, possible fine-tuning, and remote serving.
