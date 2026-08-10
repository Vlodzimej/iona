# Тезаурус

[Документация](README.md) · [Обзор](project-overview.md) · [Harness](harness/README.md) · [Agent runtime](agent/README.md)

В тексте документации некоторые термины оформлены через HTML-тег `<abbr>`: при наведении совместимый Markdown renderer показывает короткую подсказку. Эта страница даёт полное человеческое объяснение и связывает термин с реализацией проекта.

## А–Д

<a id="term-agent"></a>

### Агент

Система, в которой модель не только отвечает текстом, но и многократно выбирает действия, получает наблюдения и продолжает работу до результата. В этом проекте агент состоит из LLM, controller, tool registry, policy, worktree, checks и logs. См. [agent runtime](agent/README.md).

<a id="term-agent-runtime"></a>

### Agent runtime

Исполняемый программный слой, который управляет жизненным циклом агентной задачи: создаёт run, вызывает модель, исполняет разрешённые tools, возвращает результаты, следит за лимитами и принимает `finish` только после проверок.

<a id="term-alias"></a>

### Alias

Дополнительный поисковый термин. Например, русское `сигнал` расширяется английскими `signal`, `signals`, `effects`. Aliases помогают лексическому retrieval сопоставлять разные языки и формулировки.

<a id="term-allowlist"></a>

### Allowlist

Явный список разрешённого. Если объекта нет в списке, он запрещён по умолчанию. Это безопаснее denylist для tools и trusted sources: новая неизвестная возможность не появляется автоматически.

<a id="term-api"></a>

### API

Application Programming Interface — формальный способ взаимодействия программ. Здесь основной внешний API — OpenAI-compatible Chat Completions, а внутренние tool APIs описаны JSON schemas.

### Agent API

Управляющий HTTP-интерфейс для создания и продолжения agent runs. Встроенная реализация принимает только review-only Docker-задачи, требует bearer token и по умолчанию доступна лишь через loopback.

<a id="term-artifact"></a>

### Artifact

Результат процесса, который можно сохранить и проверить: Git patch, build output, test report, context bundle или презентация. Production provenance связывает artifact с source commit и evidence.

<a id="term-budget"></a>

### Budget

Жёсткий предел ресурса: bytes контекста, tokens ответа, tool calls, iterations, changed files, время или память. Budget не только контролирует стоимость, но и ограничивает blast radius.

<a id="term-capability"></a>

### Capability

Конкретное полномочие на действие. Tool `read_file` — capability читать ограниченный файл; `apply_patch` — capability применить проверенный diff. Узкие capabilities безопаснее общего shell.

<a id="term-chat-completions"></a>

### Chat Completions

API-формат, где клиент отправляет последовательность сообщений с ролями `system`, `user`, `assistant`, а модель возвращает следующее assistant message и, при поддержке, tool calls.

<a id="term-chunk"></a>

### Chunk

Ограниченный фрагмент reference-файла. Retriever ранжирует chunks и добавляет только лучшие, чтобы не отправлять модели весь corpus.

<a id="term-context-window"></a>

### Context window

Максимальный объём tokens, который модель может учитывать в одном запросе: system prompt, history, retrieved knowledge, tool results и ожидаемый output. Большое окно не гарантирует качество; нерелевантный контекст может мешать.

<a id="term-controller"></a>

### Controller

Доверенный детерминированный код вокруг модели. Он решает, какие tools существуют, проверяет аргументы, исполняет действия и применяет лимиты. В проекте основная логика находится в `scripts/agent/lib/runtime.mjs`.

<a id="term-denylist"></a>

### Denylist

Список всегда запрещённых объектов: secrets, `.git`, signing keys и generated artifacts. В path policy denylist применяется до allowed/protected rules.

<a id="term-deterministic"></a>

### Детерминированный

При одинаковом вводе действует по заранее определённым правилам. Policy parser и tool handler должны быть детерминированными, тогда как LLM generation вероятностна.

## E–М

<a id="term-eval"></a>

### Eval / evaluation

Зафиксированная задача и процедура измерения качества модели или harness. Может проверять retrieval sources, факты, forbidden claims, latency, tool behavior и итоговые tests.

<a id="term-executor"></a>

### Executor

Граница исполнения уже разрешённых controller-ом операций. DockerExecutor запускает patch/check в ограниченном контейнере; LocalExecutor служит явным development fallback. Executor не решает path policy и не выбирает произвольные команды.

<a id="term-evidence"></a>

### Evidence

Машинно полученное доказательство результата: status команды, test report, build log и hash patch. Текст модели «всё готово» evidence не является.

<a id="term-fine-tuning"></a>

### Fine-tuning

Дополнительное обучение, которое изменяет веса существующей модели на специализированном dataset. Текущий проект fine-tuning не выполняет; знания добавляются через harness во время запроса.

<a id="term-finish"></a>

### `finish`

Специальный controller-only tool перехода к завершению. Он запускает обязательный full validation и принимает run только при успехе.

<a id="term-gateway"></a>

### Gateway

Сервис перед model/agent endpoint, который обеспечивает TLS termination, authentication, authorization, rate limits, request validation и audit metadata. Для удалённого доступа gateway предпочтительнее прямого открытия model port.

<a id="term-hallucination"></a>

### Галлюцинация

Убедительно звучащее, но неверное утверждение модели: несуществующий API, выдуманная версия или неподдерживаемый plugin. Evals должны явно проверять критические hallucinations.

<a id="term-hardening"></a>

### Hardening

Систематическое усиление защиты: минимальные права, network isolation, контейнеры, quotas, secret management, adversarial tests, audit и rollback.

<a id="term-harness"></a>

### Harness

Управляющий инженерный слой вокруг модели. Он выбирает знания, собирает prompt, общается с endpoint, обрабатывает ответы, вводит policy, tools, проверки и измерения. Узкий model harness не обязательно имеет tools; полный agent harness включает runtime.

<a id="term-in-context-learning"></a>

### In-context learning

Способ влиять на поведение модели, добавляя инструкции и примеры прямо в текущий prompt, без изменения её весов. Skills в этом проекте работают именно так.

<a id="term-inference"></a>

### Inference

Выполнение уже обученной модели для получения ответа. Parameters вроде temperature, maximum tokens и reasoning effort влияют на inference, но не переписывают базовые weights.

<a id="term-json-schema"></a>

### JSON Schema

Машиночитаемое описание структуры JSON. Tool schema перечисляет имя, свойства, типы, обязательные поля и допустимые значения arguments.

<a id="term-llm"></a>

### LLM

Large Language Model — большая языковая модель. Она предсказывает продолжение текста и может генерировать код, но сама по себе не имеет доступа к файлам, Git или терминалу.

<a id="term-lm-studio"></a>

### LM Studio

Локальный runtime/сервер для запуска моделей, который может предоставлять OpenAI-compatible endpoint. В текущей конфигурации через него доступна `gpt-oss-20b`.

## Н–Р

<a id="term-observation"></a>

### Observation / наблюдение

Структурированный результат инструмента, который controller возвращает модели: строки файла, search matches, status patch или результаты tests. Observation ограничивается по размеру.

<a id="term-observability"></a>

### Observability / наблюдаемость

Способность понять внутреннее состояние системы по metrics, logs, traces и source metadata. `ai:context` делает retrieval наблюдаемым, а `events.jsonl` — последовательность agent run.

<a id="term-openai-compatible"></a>

### OpenAI-compatible

API, повторяющий ключевые схемы OpenAI endpoints, например `/v1/models` и Chat Completions. Совместимость бывает неполной, поэтому tool calling и error cases нужно contract-testировать.

<a id="term-opt-in"></a>

### Opt-in

Возможность выключена по умолчанию и включается явным действием. Project reference, protected writes и application of patch используют opt-in принципы.

<a id="term-patch"></a>

### Patch / diff

Текстовое описание изменений между версиями файлов. Unified Git diff содержит paths и hunks. Controller может проверить patch до применения и показать его человеку для review.

<a id="term-approval"></a>

### Approval

Зафиксированное решение человека разрешить или отклонить опасную capability. В этом runtime разрешение связано с конкретным run, точным hash аргументов, paths и сроком действия, поэтому не является общей «галочкой доверия модели».

<a id="term-policy"></a>

### Policy

Формальные правила, которые механически разрешают или запрещают действие. Prompt просит модель вести себя правильно; policy не даёт выполнить запрещённый шаг даже при неправильном поведении модели.

<a id="term-prompt"></a>

### Prompt

Все сообщения, переданные модели: system rules, context, task, history и tool observations. Prompt — данные для модели, но не надёжная security boundary.

<a id="term-prompt-injection"></a>

### Prompt injection

Попытка внедрить в недоверенные данные текстовые «инструкции», которые конфликтуют с настоящими правилами. Защита требует механических tool/policy boundaries.

<a id="term-protected-path"></a>

### Protected path

Путь, запись в который возможна только после exact approval либо локального maintenance elevation. В проекте это configs, prompts, scripts, CI и native platform files.

<a id="term-provenance"></a>

### Provenance

Происхождение результата: какой commit, model, config, runner image и набор checks создали конкретный artifact. Provenance позволяет доказать воспроизводимость и обнаружить подмену.

<a id="term-rag"></a>

### RAG

Retrieval-Augmented Generation — подход, где перед generation система находит релевантные знания и добавляет их в prompt. Текущий lexical skill retrieval — простой вариант RAG.

<a id="term-reasoning-effort"></a>

### Reasoning effort

Параметр model runtime, управляющий объёмом внутренней вычислительной работы для ответа. Более высокий уровень может помочь сложным задачам, но увеличивает latency/cost и не исправляет отсутствующие знания.

<a id="term-reference"></a>

### Reference

Справочный файл skill или opt-in файл проекта. Skill reference считается trusted guidance только потому, что его package явно allowlisted; project reference всегда считается untrusted example.

<a id="term-retrieval"></a>

### Retrieval

Поиск и выбор фрагментов знаний для конкретного запроса. В проекте используются tokens, aliases, triggers, routes, lexical score и byte budget.

## С–Я

<a id="term-sandbox"></a>

### Sandbox

Изолированная среда, которая ограничивает filesystem, network, processes и resources исполняемой программы. Git worktree изолирует изменения логически, но полноценная security sandbox требует OS/container/VM controls.

<a id="term-skill"></a>

### Skill

Пакет domain instructions и references. Он учит harness, какие знания загрузить для Angular или Capacitor задачи, но не изменяет weights модели.

<a id="term-system-prompt"></a>

### System prompt

Сообщение высшего уровня, задающее поведение модели и контекст. Оно важно для качества, но controller не должен полагаться на него как на единственную защиту.

<a id="term-tool-call"></a>

### Tool call

Структурированный запрос модели вызвать capability с JSON arguments. Controller может принять, отклонить или безопасно исполнить его.

<a id="term-tool-registry"></a>

### Tool registry

Фиксированный список tools и их schemas. Если имени нет в registry, модель не получает соответствующего полномочия.

<a id="term-truncation"></a>

### Truncation / усечение

Обрезание context, tool output или model completion из-за лимита. Planned truncation помечается metadata; неожиданно оборванный model response отклоняется.

<a id="term-trusted-computing-base"></a>

### Trusted computing base

Минимальный набор компонентов, корректность которых необходима для безопасности. Здесь это controller, policy, tool handlers, sandbox configuration и approval boundary.

<a id="term-worktree"></a>

### Git worktree

Дополнительная рабочая копия Git repository, связанная с той же object database. Agent использует detached worktree, чтобы промежуточные изменения не попадали в primary checkout.

<a id="term-zero-trust"></a>

### Zero trust

Принцип «не доверять по расположению или имени; проверять каждое действие». В agent environment это означает проверку identity, tool, path, input, output и evidence на каждом переходе.

---

← [Создание harness](build-your-own-harness.md) · [Документация](README.md) · [Презентация](presentation/ionic-llm-harness-overview.pptx)
