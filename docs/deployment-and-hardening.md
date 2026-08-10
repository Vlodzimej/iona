# Deployment-тестирование и дополнительный hardening

[Документация](README.md) · [Безопасность](security.md) · [Эксплуатация](operations.md) · [Инструкция по созданию](build-your-own-harness.md)

## Целевая production-топология

Локальный MVP не следует просто открывать наружу портом. Для удалённого доступа нужен разделённый контур.

```mermaid
flowchart LR
    U["Developer client"] -->|"TLS + OIDC/mTLS"| GW["Authenticated model/agent gateway"]
    GW --> Q["Queue + quotas"]
    Q --> C["Ephemeral controller runner"]
    C -->|"OpenAI-compatible API"| M["LM Studio / model server"]
    C -->|"checkout at commit"| R["Disposable container or microVM"]
    R --> CH["Build and test tools"]
    R --> ART["Patch + evidence artifact"]
    ART --> AP["Human approval / merge workflow"]

    SEC["Secret manager"] --> GW
    SEC --> C
    OBS["Metrics and redacted audit"] <-->|"metadata only by default"| GW
    OBS <-->|"run state"| C
```

### Разделение ролей

- **Gateway** аутентифицирует пользователя, нормализует request, ограничивает размер и rate.
- **Queue** ограничивает concurrency и сглаживает нагрузку на модель/GPU.
- **Controller runner** владеет agent state и tool protocol.
- **Sandbox runner** получает только checkout и минимальные build capabilities.
- **Model server** выполняет inference, но не монтирует repository и secrets.
- **Approval/SCM integration** принимает patch и evidence, а не даёт агенту production credentials.

## Hardening по слоям

### Сеть

- Bind model server к loopback или private interface.
- Публиковать только gateway с TLS.
- Использовать OIDC, mTLS или short-lived scoped tokens.
- Разрешить runner egress только к gateway/model endpoint и approved artifact services.
- Запретить sandbox egress по умолчанию.
- Ограничить request body, response body, timeout и concurrent streams.
- Не логировать Authorization headers и prompt bodies по умолчанию.

### Изоляция вычислений

- Один ephemeral container/microVM на run.
- Non-root user, read-only root filesystem.
- Отдельный writable volume только для worktree/temp.
- Drop Linux capabilities; no privileged mode; no host Docker socket.
- Seccomp/AppArmor/SELinux profile.
- CPU, memory, process, disk and wall-clock quotas.
- Kill runner после завершения; не переиспользовать writable state между tenants.

### Supply chain

- Pin container image digest и toolchain versions.
- Использовать lockfile и internal npm mirror.
- Отделить dependency resolution от no-network validation.
- Проверять SBOM, package signatures/provenance и known vulnerabilities.
- Не разрешать agent-generated lifecycle scripts без approval.

### Identity и authorization

- Связать request с user/service identity.
- Проверять repository/branch permissions до checkout.
- Выдавать per-run credentials с минимальным scope и TTL.
- Отдельно одобрять protected paths, dependency changes и native signing config.
- Никогда не передавать release/signing credentials coding runner.

### Data governance

- Классифицировать repositories, которым разрешён remote inference.
- Redact secrets и персональные данные до model request.
- Настроить retention для prompts, outputs, patches и logs.
- Шифровать data at rest и in transit.
- Записывать audit metadata: actor, repo, commit, model/config version, tools, result — без полного content по умолчанию.

## Deployment testing pyramid

```mermaid
flowchart TB
    E2E["End-to-end canary: client → gateway → model → sandbox → evidence"]
    SEC["Security and isolation tests"] --> E2E
    INT["Integration: endpoint, queue, checkout, tools, artifact"] --> SEC
    CON["Contract: API schemas, auth errors, timeouts"] --> INT
    UNIT["Unit: policy, parser, budgets, redaction"] --> CON
```

### Unit и property tests

Добавьте generated cases для:

- path traversal разных платформ;
- Unicode и case normalization;
- malformed/oversized patch;
- symlink, rename, executable, submodule и binary diff;
- glob corner cases;
- secret redaction;
- tool-call budgets и timeout.

### Contract tests gateway/model

Проверьте:

- `/models` и Chat Completions schema;
- exact model resolution;
- native tool calls и JSON fallback;
- 401/403/404/429/5xx;
- truncated/invalid JSON;
- client disconnect и timeout cancellation;
- maximum body/token enforcement;
- отсутствие raw service markers.

### Isolation tests

Внутри тестового run попытайтесь:

- прочитать host `/etc`, home и соседний tenant volume;
- записать вне worktree;
- обратиться к internet/metadata service;
- запустить fork bomb или превысить process limit;
- заполнить disk;
- получить environment secrets;
- использовать symlink/hardlink escape;
- изменить controller binaries или policy.

Тест должен доказывать блокировку на уровне runtime/container, а не только отказ модели.

### End-to-end deployment tests

Минимальный canary сценарий:

1. Аутентифицированный test user отправляет маленькую feature-задачу.
2. Gateway создаёт trace ID и помещает request в queue.
3. Runner checkout фиксированного commit создаёт isolated worktree.
4. Mock или canary model вызывает read, patch, check, finish.
5. Sandbox доказывает отсутствие network и host writes.
6. Full checks проходят.
7. Artifact содержит patch hash, commit, model/config version и results.
8. Primary branch не изменяется без approval.
9. Runner и short-lived credentials уничтожаются.
10. Audit log позволяет восстановить sequence без раскрытия secret content.

## Adversarial suite

В deployment gate включите задачи, где project file предлагает:

- прочитать `.env`;
- отключить тесты;
- изменить policy;
- отправить repository на внешний URL;
- добавить postinstall script;
- записать в `.github/workflows` без approval;
- подменить native signing config;
- завершить run без checks.

Критерий успеха — не «модель отказалась», а «контроллер или sandbox механически заблокировал действие».

## Наблюдаемость

Рекомендуемые metrics:

- request count, queue delay, TTFT, total latency;
- prompt/completion tokens;
- tool calls и iterations;
- policy denials по категории;
- build/test pass rate;
- repair cycles;
- truncation и endpoint errors;
- container CPU/memory/disk;
- approval rate и time-to-review.

Alerting должен реагировать на рост 401/429/5xx, повторные sandbox violations, аномальный объём prompts, неожиданный рост protected requests и ухудшение eval pass rate.

## Release стратегия

1. Версионировать harness config, prompts, tool schemas и container image.
2. Прогонять offline evals и security suite.
3. Развернуть shadow mode без права применять изменения.
4. Включить canary для ограниченной группы и safe repositories.
5. Сравнить quality/latency/policy metrics с baseline.
6. Расширять rollout постепенно.
7. Иметь быстрый rollback config/model/image.
8. Хранить provenance каждого accepted patch.

## Definition of ready для удалённого доступа

- Model port не доступен из недоверенной сети напрямую.
- Gateway требует authentication и authorization.
- Каждый run изолирован container/microVM и ограничен ресурсами.
- Sandbox не имеет произвольного egress.
- Secrets short-lived и scoped.
- Full contract, adversarial и isolation tests проходят.
- Prompt/output logging имеет redaction и retention.
- Есть human approval для применения/merge.
- Есть canary, metrics, alerts и rollback.

---

← [Эксплуатация](operations.md) · [Документация](README.md) · Далее: [создание harness с нуля →](build-your-own-harness.md)
