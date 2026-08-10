# Angular + Capacitor local-model harness

This harness gives `gpt-oss-20b` task-specific access to the live `angular-developer` and `capacitor-plugins` packages under `~/.agents/skills`. It does not fine-tune model weights and does not copy skill content into the repository. Every request reloads the manifests and retrieves the most relevant references, so skill updates become available immediately.

The application checked out beside this directory is only an optional example corpus. Its files are excluded from model context by default and never define model behavior.

## Request flow

1. Read both external `SKILL.md` manifests.
2. Expand Russian task terms with the aliases in `ai/harness.json`.
3. Rank reference Markdown files by path and content relevance.
4. Inject compact excerpts from both manifests plus the selected reference chunks as trusted skill context.
5. Add application files only when `--with-project-reference` is explicitly passed; label them as untrusted examples.
6. Send the request to the configured OpenAI-compatible Chat Completions endpoint.
7. Return only `choices[0].message.content`; never expose or replay reasoning fields.

## Setup

Use Node 24 for the harness scripts:

```sh
nvm use
npm run ai:doctor
```

Create the ignored local connection file:

```sh
cp .env.local-ai.example .env.local-ai
```

Configure a direct endpoint, protected gateway, or optional tunnel as described
in `ai/remote-model.md`, then verify the connection:

```sh
npm run ai:smoke
```

## Inspect skill retrieval

The following commands do not contact the model:

```sh
npm run ai:context -- --query "Сделай форму на Angular signals"
npm run ai:context -- --query "Выбери плагин камеры и биометрии для Capacitor"
```

To save a bundle, the output must stay under the ignored `ai/generated` directory:

```sh
npm run ai:context -- --query "Angular HttpClient и обработка ошибок" --output ai/generated/http-context.json
```

## Ask the model

```sh
npm run ai:ask -- "Предложи архитектуру Angular-экрана, который получает данные через HttpClient"
npm run ai:ask -- --task-file ai/evals/tasks/capacitor-plugin-selection.json
```

Only when code examples from the current checkout are useful:

```sh
npm run ai:ask -- --with-project-reference "Покажи, как адаптировать существующий сервис камеры"
```

`ai:ask` is read-only: it prints the answer and never applies model-generated changes.

## Versioned files

- `harness.json` — skill allowlist, retrieval limits, bilingual aliases, and optional reference-project policy.
- `prompts/system.md` — stack-focused model behavior independent of any particular application.
- `remote-model.md` — provider-neutral endpoint and optional tunnel instructions.
- `evals/task.schema.json` — evaluation task contract.
- `evals/tasks` — frozen Angular and Capacitor routing checks.

Connection settings, generated contexts, evaluation reports, model runs, datasets, and weights remain ignored by Git.

## Context-window tuning

The harness uses a conservative 6 KB skill budget with excerpt/chunk retrieval.
Choose the model context window for the available hardware and measured task
set; 32 KB is a useful starting target when the runtime supports it.

Increase `LOCAL_AI_SKILL_MAX_BYTES` in measured steps and compare larger reference bundles against the frozen evals before changing the default. See `ai/ROADMAP.md`.
