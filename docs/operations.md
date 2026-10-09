# Эксплуатация и диагностика

[Документация](README.md) · [Быстрый старт](getting-started.md) · [Безопасность](security.md) · [Deployment-hardening](deployment-and-hardening.md)

## Повседневный цикл

```mermaid
flowchart LR
    U["Обновить main и npm ci"] --> D["npm run ai:doctor"]
    D --> C["Проверить retrieval через ai:context"]
    C --> R["Запустить read-only вопрос или agent task"]
    R --> V["Ревью diff и evidence"]
    V --> Q["npm run verify"]
    Q --> COMMIT["Коммит человеком"]
```

## Справочник команд

| Команда                               | Назначение                             |                  Обращается к модели |                   Меняет source files |
| ------------------------------------- | -------------------------------------- | -----------------------------------: | ------------------------------------: |
| `npm start`                           | Angular dev server                     |                                  нет |                                   нет |
| `npm run build`                       | Production Angular build               |                                  нет |                                   нет |
| `npm test -- --watch=false`           | Unit tests один раз                    |                                  нет |                                   нет |
| `npm run cap:doctor`                  | Проверка Capacitor                     |                                  нет |                                   нет |
| `npm run cap:check`                   | Offline-проверка загрузки config       |                                  нет |                                   нет |
| `npm run docs:check`                  | Проверка внутренних Markdown links     |                                  нет |                                   нет |
| `npm run ai:doctor`                   | Проверка skills/config/routing         |                                  нет |                                   нет |
| `npm run ai:test`                     | Frozen schema и retrieval tests        |                                  нет |                                   нет |
| `npm run ai:context -- --query "..."` | Показать выбранный context bundle      |                                  нет |    только с `--output` в ignored path |
| `npm run ai:smoke`                    | Проверка endpoint/model response       |                                   да |                                   нет |
| `npm run ai:ask -- "..."`             | Read-only консультация                 |                                   да |                                   нет |
| `npm run ai:eval`                     | Eval модели + standalone HTML report   |                                   да |           только ignored `ai/reports` |
| `npm run ai:rescore -- ...`           | Пересчитать неизменные model answers   |                                  нет |           только ignored `ai/reports` |
| `npm run ai:compare -- ...`           | Сравнительный standalone HTML report   |                                  нет |           только ignored `ai/reports` |
| `npm run agent:doctor`                | Проверка agent prerequisites/isolation |                                  нет |                                   нет |
| `npm run agent:docker:build`          | Собрать pinned Docker runner image     | Docker build может скачать base/deps |                                   нет |
| `npm run agent:test`                  | Tests policy/protocol/tools/runtime    |     mock endpoint в integration test |                    временные fixtures |
| `npm run agent -- "..."`              | Изменение в isolated worktree          |                                   да |                       только worktree |
| `npm run agent -- "..." --apply`      | То же + применение успешного patch     |                                   да |                      да, после checks |
| `npm run agent:status -- <run-id>`    | Показать сохранённое состояние         |                                  нет |                                   нет |
| `npm run agent:approve -- <id>`       | Одобрить exact protected action        |                                  нет |             только ignored state file |
| `npm run agent:resume -- <run-id>`    | Продолжить paused run                  |                                   да |                       только worktree |
| `npm run agent:api`                   | Запустить loopback Agent API           |                                   да |        через Docker isolated worktree |
| `npm run opencode -- --repo PATH`     | OpenCode через внешний MCP harness     |                                   да |      только внешний isolated worktree |
| `iona doctor --repo PATH`             | Preflight общего harness и target      |                                  нет |                                   нет |
| `npm run harness:test`                | MCP/external-state integration tests   |                                  нет |                    временные fixtures |
| `npm run harness -- prepare PATH`     | Собрать project runner по lockfile     |          Docker build скачивает deps |                   внешний image cache |
| `npm run harness -- status REPO RUN`  | Показать состояние внешнего run        |                                  нет |                                   нет |
| `npm run harness -- approve REPO ID`  | Одобрить exact protected patch         |                                  нет |             только внешний state file |
| `npm run harness -- apply REPO RUN`   | Применить sealed validated patch       |                                  нет |      да, после повторных guard checks |
| `npm run verify`                      | Полный repository gate                 |           нет для source-only checks | build artifacts по правилам toolchain |

## Конфигурация модели

Локальный ignored файл `.env.local-ai` загружается автоматически. После изменения конфигурации запускайте:

```bash
npm run ai:doctor
npm run ai:smoke
```

Если server видит несколько моделей, задайте точный `LOCAL_AI_MODEL`. Если endpoint удалённый, используйте TLS и token. Provider-neutral примеры находятся в [`ai/remote-model.md`](../ai/remote-model.md).

## Диагностика плохого ответа

Идите снизу вверх, не меняя сразу prompt и модель:

1. Выполните `ai:context` с той же формулировкой.
2. Проверьте tokens, selected sources и budget.
3. Если source неверный — исправьте alias/route/eval.
4. Если source верный, но фрагмент обрезан — измерьте chunk/context budget.
5. Если context корректен — проверьте system prompt и task clarity.
6. Сравните ответ на frozen task с теми же sampling parameters.
7. Только затем меняйте reasoning effort, context window или модель.

## Диагностика agent run

Runtime печатает run ID и worktree path. Журнал:

```bash
sed -n '1,240p' .agent/runs/<run-id>/events.jsonl
```

Для удобства используйте `jq`, если он установлен:

```bash
jq -c '{timestamp, type, iteration, tool, result}' \
  .agent/runs/<run-id>/events.jsonl
```

Не прикладывайте полный log к публичной issue: сначала проверьте task text, patches и model output на чувствительные данные.

Для внешнего OpenCode run состояние находится не в проекте, а в `~/.local/share/iona/repositories/<repository-id>/runs/<run-id>`. Команды review, approval и apply приведены в [руководстве по внешним проектам](harness/external-projects-and-opencode.md).

Если status равен `waiting_approval`, сначала изучите точный patch в worktree и paths в `agent:status`. Решение и продолжение — два отдельных действия; это позволяет отложить resume или выполнить его после перезапуска процесса. Полный lifecycle описан в [разделе об executors и API](agent/executors-approvals-api.md).

## Типовые проблемы

### `Required skill is missing`

Установите [обязательные user-scope packages](harness/required-skills.md) и проверьте, что существуют:

```text
~/.agents/skills/angular-developer/SKILL.md
~/.agents/skills/capacitor-plugins/SKILL.md
```

Другие расположения намеренно не поддерживаются на host: это сохраняет единый доверенный user-scope и не позволяет подключённому проекту подменить инструкции. Путь `/skills` используется только как read-only mount внутри Docker.

### `The primary worktree must be clean`

Agent intentionally не смешивает изменения. Закончите текущую работу: commit или осознанный stash. Не используйте destructive reset ради запуска агента.

### `No supported process sandbox is available`

Это относится только к явно выбранному LocalExecutor. Предпочтительный путь — собрать Docker image и оставить default `docker`. Явный `--allow-host-execution` допустим, только если host уже изолирован и вы принимаете риск выполнения versioned check scripts.

### `Docker daemon is unavailable` или `Runner image is missing`

Запустите установленный Docker runtime, затем выполните `npm run agent:docker:build` и `npm run agent:doctor`. Agent API намеренно не стартует без готового Docker executor.

### Ответ усечён

Увеличьте `LOCAL_AI_MAX_TOKENS` измеренно. Одновременно проверьте, не переполнен ли prompt нерелевантным context. Увеличение output budget не исправляет плохой retrieval.

### Модель не вызывает tools

Проверьте поддержку tool calling в server template. Runtime отправит напоминание и поддерживает JSON fallback, но repeated failure указывает на несовместимый chat template или модель.

### Full checks слишком медленные

Во время работы модель может выбирать `fast`/`build`, но `finish` всегда требует `full`. Ускоряйте caching и CI runner; не ослабляйте finish gate без evidence.

## Maintenance cadence

### При обновлении stack

1. Обновить packages и lockfile человеком или protected run.
2. Проверить официальные migration guides.
3. Обновить `AGENTS.md`, prompts и skills при изменении conventions.
4. Запустить `npm run verify` и расширенные native checks.
5. Добавить regression eval для обнаруженной несовместимости.

### При обновлении skill

1. `ai:doctor`.
2. Несколько representative `ai:context` запросов.
3. Frozen retrieval suite.
4. Answer quality runs.
5. Review выросшего context size и новых external references.

### При изменении tool/policy

1. Threat model review.
2. Negative unit tests на обход.
3. Runtime integration test с mock endpoint.
4. Container/sandbox test.
5. Документация и version bump schema при несовместимом изменении.

## Очистка runs

Проект пока не удаляет старые `.agent/runs` и worktrees автоматически. Перед очисткой:

1. Убедитесь, что нужный diff принят или сохранён.
2. Проверьте `git worktree list`.
3. Удалите конкретный старый worktree через `git worktree remove <exact-path>`.
4. Удалите соответствующий run directory по принятой retention policy.
5. Выполните `git worktree prune` только для stale registrations.

Не используйте широкие recursive delete targets и unresolved variables.

---

← [Безопасность](security.md) · [Документация](README.md) · Далее: [deployment-hardening →](deployment-and-hardening.md)
