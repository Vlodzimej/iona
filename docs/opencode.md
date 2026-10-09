# OpenCode, MCP harness и удалённая модель

[Документация](README.md) · [Внешние проекты](harness/external-projects-and-opencode.md) · [Обязательные skills](harness/required-skills.md) · [Удалённая модель](../ai/remote-model.md) · [Безопасность](security.md)

OpenCode используется как единственный reasoning agent. Он обращается к `gpt-oss-20b` через OpenAI-compatible endpoint, загружает global skills и работает с целевым Git-репозиторием только через локальный MCP server harness.

## Два независимых соединения

```mermaid
flowchart LR
    OC["OpenCode"] -->|"Chat Completions"| LM["LM Studio / gpt-oss-20b"]
    OC -->|"stdio MCP"| H["Harness tools"]
    H --> WT["External Git worktree"]
    H --> D["Docker Executor"]
```

Model endpoint выполняет inference. MCP server предоставляет действия над проектом. Успешное соединение с моделью не означает, что MCP или Docker готовы, и наоборот.

## Локальная конфигурация модели

Создайте ignored файл, если он ещё не подготовлен:

```bash
cp .env.local-ai.example .env.local-ai
```

Заполните provider-neutral значения:

```dotenv
LOCAL_AI_BASE_URL=https://model.example.com/v1
LOCAL_AI_MODEL=gpt-oss-20b
LOCAL_AI_API_KEY=<token-if-required>
```

Проверьте endpoint и Docker:

```bash
npm run ai:doctor
npm run ai:smoke
npm run agent:docker:build
npm run agent:doctor
```

## Запуск

Для текущего boilerplate:

```bash
npm run opencode
```

Для другого проекта без переноса harness-файлов:

```bash
iona doctor --repo /absolute/path/to/project
iona opencode --repo /absolute/path/to/project
```

Для автоматического теста или CI задайте общий предел сеанса; интерактивный запуск по умолчанию не ограничен:

```bash
iona opencode --repo /absolute/path/to/project --timeout-seconds 900 run "Проверь проект"
```

Предел охватывает весь процесс OpenCode, а не отдельный model request. При зависшей генерации launcher завершится с кодом `124`; незавершённый run затем нужно проверить через `status` и удалить через `discard`.

Для команды `run` одного кода завершения OpenCode недостаточно. Launcher дополнительно требует ровно один новый harness run со статусом `ready` или `waiting_approval`. Если модель напечатала tool call как текст, оставила run `active` или вообще не вызвала `begin`, команда завершается ошибкой.

User-scope команду один раз создаёт `npm link` в каталоге общей установки harness. Если link не нужен, используйте прежнюю форму `npm --prefix /path/to/harness run opencode -- --repo /path/to/project`.

Launcher загружает `.env.local-ai` из общей установки, регистрирует целевой Git root, создаёт нейтральный OpenCode workspace во внешнем state root и передаёт обязательную inline-конфигурацию. Project-local `opencode.json` целевого репозитория не может вернуть прямые файловые полномочия, потому что OpenCode вообще не запускается из этого project tree, а enforced config загружается с более высоким приоритетом.

## Разрешения

Enforced policy использует deny-by-default:

```json
{
  "permission": {
    "*": "deny",
    "skill": "allow",
    "question": "allow",
    "todowrite": "allow",
    "doom_loop": "ask",
    "iona_*": "allow"
  }
}
```

Встроенные `read`, `edit`, `apply_patch`, `bash`, LSP и external-directory tools не разрешены. Это принципиальное отличие от прежнего режима `edit: ask` / `bash: ask`: подтверждение OpenCode больше не является границей безопасности. Protected approval реализует сам harness и не отдаёт инструмент решения модели.

## Skills

OpenCode автоматически обнаруживает совместимые global skills в `~/.agents/skills`. Обязательны `angular/skills`, `erkamyaman/ionic-capacitor-skills` и `Cap-go/capgo-skills`; команды установки, compact retrieval allowlist и lifecycle routing приведены в [руководстве](harness/required-skills.md) и [матрице покрытия](harness/skill-coverage.md). Копировать их в проект не нужно.

## Диагностика

Проверить resolved model configuration:

```bash
npm run opencode:config
```

Проверить модель:

```bash
npm run opencode:models
```

Проверить MCP implementation независимо от OpenCode:

```bash
npm run harness:test
```

### `LOCAL_AI_BASE_URL is not configured`

Создайте `.env.local-ai` в репозитории harness. Не добавляйте endpoint или token в Git.

### OpenCode не найден

Установите OpenCode официальным способом или задайте `OPENCODE_BIN`. Launcher не устанавливает и не обновляет binary.

### Модель долго не вызывает первый tool

Для bounded-прогона используйте `--timeout-seconds`. Harness не является skill: корректный первый repository tool — `iona_begin`; сообщение `Skill "ionic-harness" not found` означает ошибочный выбор инструмента моделью. Обновлённый system prompt явно запрещает такой вызов, но при его повторении запуск следует считать неуспешным, а не ждать бесконечно.

### MCP server не запускается

Выполните `npm ci` в harness и `npm run harness:test`. Проверьте, что целевой путь является доступным Git-репозиторием.

### Checks не запускаются

Соберите base runner командой `npm run agent:docker:build` в общей установке harness, запустите Docker daemon и проверьте наличие `package-lock.json`. Для диагностики project-specific image выполните `iona prepare /path/to/project`. Сеть используется только во время контролируемой сборки dependency image; исполняемые checks сети не получают.

### Protected patch остановился

Это ожидаемое состояние. Используйте repository ID и approval ID из результата для локальной команды `iona approve <repository-id> <approval-id>`, затем попросите OpenCode повторить идентичный patch.

---

← [Эксплуатация](operations.md) · [Внешние проекты →](harness/external-projects-and-opencode.md)
