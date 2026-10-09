# Iona

A local development harness and reusable Angular, Ionic and Capacitor starter for coding with private models.

## Documentation

The connected Russian-language documentation portal explains the project from first principles, with an emphasis on the LLM harness, agent runtime, security boundaries, deployment hardening, and a step-by-step guide for building a similar environment:

- [Documentation home](docs/README.md)
- [Architecture](docs/architecture.md)
- [Harness](docs/harness/README.md)
- [Using the harness with existing projects](docs/harness/using-with-existing-projects.md)
- [External projects and OpenCode](docs/harness/external-projects-and-opencode.md)
- [Required system skills](docs/harness/required-skills.md)
- [Skill coverage across mobile development](docs/harness/skill-coverage.md)
- [Visual debugging and mockup comparison](docs/harness/visual-debugging.md)
- [Harness FAQ](docs/harness/faq.md)
- [Practical harness test plan](docs/harness/practical-test-plan.md)
- [OpenCode setup](docs/opencode.md)
- [Build your own harness](docs/build-your-own-harness.md)
- [Glossary](docs/glossary.md)
- [Overview presentation](docs/presentation/iona-overview.pptx)

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
npm run harness:test
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
- `~/.agents/skills/ionic-native-essentials`
- `~/.agents/skills/ionic-deep-links`

OpenCode can additionally load task-specific skills from the globally installed
`erkamyaman/ionic-capacitor-skills` and `Cap-go/capgo-skills` packages. Install
commands, upstream sources, and allowlist rules are documented in
[Required system skills](docs/harness/required-skills.md).

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
npm run agent:docker:build
npm run agent:doctor
npm run agent -- "Add an accessible empty-state component to the home page"
```

Docker is the default executor. Validation containers have no network, use a
read-only root filesystem, drop Linux capabilities, run as a non-root user,
and have CPU, memory, PID, and temporary-storage limits. A local executor is
available explicitly for development with `--executor local`.

Use `--apply` only when successful, fully validated changes should be copied
back to the still-clean primary worktree:

```bash
npm run agent -- "Add an accessible empty-state component" --apply
```

By default, writes are limited to application roots such as `src/`. Package,
tooling, native-platform, agent, and CI files are protected. If a task needs
one, the run pauses and prints an exact approval request:

```bash
npm run agent:approve -- <approval-id>
npm run agent:resume -- <run-id>
```

Approval is bound to the run, exact patch hash, capability, protected paths,
and TTL. Secret paths and Git metadata remain denied. The broad
`--allow-protected` option exists only as a trusted local maintenance escape
hatch and is never enabled by the Agent API.

A bearer-token protected API can expose review-only Docker runs to a local
gateway:

```bash
npm run agent:api
```

It binds to loopback by default. Put TLS, user identity, authorization, and
rate limiting in front of it before remote use. See
[Executors, approvals, and Agent API](docs/agent/executors-approvals-api.md).

Run transcripts can contain task text, patches, and model output. They are
stored locally under `.agent/runs` with restricted file permissions and are
never committed.

## External projects through OpenCode

OpenCode can be the sole reasoning agent while this repository remains an
external security and execution harness. No harness source, prompt, policy, or
state file is copied into the target repository:

```bash
npm link
npm run agent:docker:build
iona doctor --repo /absolute/path/to/another-project
iona prepare /absolute/path/to/another-project
iona opencode --repo /absolute/path/to/another-project
```

The launcher registers the canonical Git repository, starts OpenCode from a
neutral state directory, injects a higher-precedence configuration that denies
its built-in file and shell tools, and exposes only the local
`iona_*` MCP tools. OpenCode still uses the configured `gpt-oss-20b`
and global `~/.agents/skills`, but all repository reads, patches, and checks go
through the harness policy.

Runs, exact approvals, logs, and detached Git worktrees live under
`~/.local/share/iona` by default. A successfully validated patch
is sealed but not copied to the primary checkout. Review and apply it with the
local human-only control command printed by the run:

```bash
iona status <repository-id> <run-id> --include-patch
iona approve <repository-id> <approval-id>
iona apply <repository-id> <run-id>
```

See [External projects and OpenCode](docs/harness/external-projects-and-opencode.md)
for the trust model, tool lifecycle, profiles, and recovery commands. The exact
user-scope skill dependencies and install commands are documented in
[Required system skills](docs/harness/required-skills.md).

## Repository layout

```text
ai/                  Model/agent policy, prompts, evaluations, and roadmap
scripts/local-ai/    Skill retrieval and OpenAI-compatible model client
scripts/agent/       Isolated worktrees, tool policy, agent loop, and tests
scripts/harness/     External repository registry, MCP server, state, and controls
docker/              Hardened no-network agent runner image
scripts/opencode/    OpenCode launcher for the ignored local connection file
src/app/             Blank standalone Ionic Angular application
src/theme/           Shared Ionic design tokens
capacitor.config.ts  Provider-neutral Capacitor configuration
opencode.json        Base OpenCode provider settings; launcher enforces MCP policy
AGENTS.md             Rules for coding agents and local models
```

Use `ai/ROADMAP.md` for the staged plan covering retrieval quality, evaluations, coding worktrees, possible fine-tuning, and remote serving.

## VS Code extension

The optional [Iona extension](extensions/vscode/README.md) provides chat and isolated coding tasks with Ollama, LM Studio, NVIDIA PAIR, or another OpenAI-compatible server.
