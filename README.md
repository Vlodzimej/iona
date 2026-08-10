# Angular Ionic Capacitor LLM Starter

A clean hybrid-mobile starter and local-model harness. The repository intentionally contains no product-specific architecture or business logic.

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

The verification pipeline checks formatting, performs a production Angular build, runs Vitest, checks Capacitor, and validates the LocalAI skill routing.

Individual commands:

```bash
npm run build
npm test -- --watch=false
npm run cap:doctor
npm run ai:doctor
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

## Repository layout

```text
ai/                  Model configuration, prompts, evaluations, and roadmap
scripts/local-ai/    Skill retrieval and LM Studio client
src/app/             Blank standalone Ionic Angular application
src/theme/           Shared Ionic design tokens
capacitor.config.ts  Provider-neutral Capacitor configuration
AGENTS.md             Rules for coding agents and local models
```

Use `ai/ROADMAP.md` for the staged plan covering retrieval quality, evaluations, coding worktrees, possible fine-tuning, and remote serving.
