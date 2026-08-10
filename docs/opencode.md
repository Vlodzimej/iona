# OpenCode и удалённая модель

[Документация](README.md) · [Удалённое подключение](../ai/remote-model.md) · [Безопасность](security.md) · [Эксплуатация](operations.md)

Проектный [`opencode.json`](../opencode.json) подключает OpenCode к текущему OpenAI-compatible endpoint LM Studio и выбирает `gpt-oss-20b` основной и вспомогательной моделью.

## Как устроена настройка

- Provider ID — `lmstudio`.
- Полный model ID внутри OpenCode — `lmstudio/gpt-oss-20b`.
- API transport — `@ai-sdk/openai-compatible` для `/v1/chat/completions`.
- Endpoint берётся из `LOCAL_AI_BASE_URL`.
- Bearer token берётся из `LOCAL_AI_API_KEY`; пустое значение допустимо только для endpoint без authentication.
- Context limit — 32768 tokens, output limit — 4096 tokens, как в текущем baseline harness.
- OpenCode загружает `AGENTS.md` и `ai/prompts/system.md` как project instructions.
- В этом репозитории доступны только модели provider `lmstudio`.
- Изменение файлов и запуск shell-команд требуют подтверждения пользователя.

В конфигурации нет hostname, IP-адреса, SSH user или token. Сетевые параметры остаются в ignored `.env.local-ai`.

## 1. Подготовить локальную конфигурацию

Если файл ещё не создан:

```bash
cp .env.local-ai.example .env.local-ai
```

Заполните значения для своего gateway, прямого endpoint или локального tunnel:

```dotenv
LOCAL_AI_BASE_URL=https://model.example.com/v1
LOCAL_AI_MODEL=gpt-oss-20b
LOCAL_AI_API_KEY=<token-if-required>
```

OpenCode использует `LOCAL_AI_BASE_URL` и `LOCAL_AI_API_KEY`. `LOCAL_AI_MODEL` продолжает использоваться основным harness; точный model ID для OpenCode зафиксирован в `opencode.json`.

## 2. Проверить endpoint

Сначала проверьте общую конфигурацию harness:

```bash
npm run ai:doctor
npm run ai:smoke
```

Затем попросите OpenCode показать итоговую конфигурацию:

```bash
npm run opencode:config
```

В resolved config должны присутствовать:

```text
model: lmstudio/gpt-oss-20b
provider: lmstudio
```

Не публикуйте полный resolved config, если он содержит реальный API key.

## 3. Проверить список моделей

```bash
npm run opencode:models
```

Команда должна показать `lmstudio/gpt-oss-20b`. Если endpoint возвращает другой model ID, сначала исправьте model alias на server либо осознанно обновите `opencode.json` и `ai/harness.json` вместе.

## 4. Запустить OpenCode

Интерактивный интерфейс:

```bash
npm run opencode
```

Одноразовая задача без TUI:

```bash
npm run opencode -- run "Объясни архитектуру приложения"
```

Launcher `scripts/opencode/run.mjs` загружает `.env.local-ai`, запускает OpenCode из корня репозитория и передаёт ему остальные arguments без изменения.

## Подтверждения действий

OpenCode является самостоятельным coding agent и не использует контролируемый runtime из `scripts/agent/`. Поэтому `opencode.json` отдельно задаёт:

```json
{
  "permission": {
    "edit": "ask",
    "bash": "ask"
  }
}
```

Перед изменением файла или запуском команды OpenCode должен запросить подтверждение. Это не заменяет container/VM isolation: для недоверенных задач и удалённого multi-user запуска используйте рекомендации из [раздела о hardening](deployment-and-hardening.md).

## Типовые ошибки

### `LOCAL_AI_BASE_URL is not configured`

Создайте `.env.local-ai` и заполните endpoint. Файл должен оставаться ignored.

### Provider или модель отсутствуют

Проверьте:

```bash
npm run ai:smoke
npm run opencode:models
```

Model ID endpoint должен совпадать с `gpt-oss-20b`.

### `401` или `403`

Проверьте `LOCAL_AI_API_KEY`, authentication gateway и срок жизни token. Не записывайте token в `opencode.json`.

### Tool calls не работают

Убедитесь, что LM Studio использует chat template с поддержкой tool calling и достаточное context window. Сам факт успешного текстового ответа не доказывает совместимость с agent tools.

### OpenCode не найден

Установите OpenCode официальным способом или задайте путь к binary через `OPENCODE_BIN`. Launcher не устанавливает и не обновляет OpenCode автоматически.

---

← [Эксплуатация](operations.md) · [Документация](README.md) · [Удалённое подключение](../ai/remote-model.md)
