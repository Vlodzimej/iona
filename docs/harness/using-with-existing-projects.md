# Использование harness в существующих проектах

[Документация](../README.md) · [Обязательные skills](required-skills.md) · [Архитектура внешнего режима](external-projects-and-opencode.md) · [OpenCode](../opencode.md) · [Диагностика](../operations.md)

Это практическое руководство позволяет подключить общий harness, OpenCode и локальную модель к уже существующему Angular/Ionic/Capacitor-проекту, не добавляя в него исходники, prompts или конфигурацию harness.

После настройки работа выглядит так:

```bash
cd /absolute/path/to/existing-project
iona doctor --repo "$PWD"
iona prepare "$PWD"
iona opencode --repo "$PWD"
```

Harness установлен один раз и обслуживает любое количество проектов. Каждый запуск использует отдельный Git worktree и внешний state directory.

## 1. Что требуется

### На компьютере разработчика

- Node.js 24.15 или новее; рекомендуемая версия задаётся `.nvmrc` общего harness.
- npm, Git и OpenCode в `PATH`.
- Запущенный Docker daemon.
- Доступ к OpenAI-compatible endpoint с `gpt-oss-20b`.
- Три [обязательных global skill source](required-skills.md).

### В целевом проекте

- Git repository с committed `HEAD` и чистым primary checkout.
- Обычные файлы `package.json` и `package-lock.json`.
- Обязательные npm scripts `build` и `test`.
- Совместимость dependency tree с Node.js 26 в Linux runner image.
- Опциональные scripts `format:check` и `cap:check`, если проект их предоставляет.

Текущий профиль `angular-ionic-capacitor` использует npm. Проекты на pnpm/Yarn, другой версии Node или другом stack требуют отдельного профиля и runner в общей установке harness. Их не нужно добавлять в целевой проект.

## 2. Одноразовая установка общего harness

Выберите постоянный каталог вне подключаемых проектов. В примерах используется переменная только для удобства текущей terminal session:

```bash
export IONA_HOME=/absolute/path/to/iona
cd "$IONA_HOME"
nvm use
npm ci
```

Не размещайте общий harness внутри целевого repository. Внешний state root также не должен пересекаться с target root; по умолчанию он находится в `~/.local/share/iona`.

### Установить skills

```bash
npx skills add angular/skills@angular-developer -g -y
npx skills add erkamyaman/ionic-capacitor-skills -g -y
npx skills add Cap-go/capgo-skills -g -y
```

Skills устанавливаются в `~/.agents/skills` один раз для всех проектов. Не копируйте `.agents/` или `skills-lock.json` в target repository.

### Настроить модель

Конфигурация соединения хранится только в ignored-файле общего harness:

```bash
cd "$IONA_HOME"
cp .env.local-ai.example .env.local-ai
```

Укажите в `.env.local-ai` OpenAI-compatible URL, точный model ID и token, если endpoint его требует:

```dotenv
LOCAL_AI_BASE_URL=http://<lm-studio-host>:1234/v1
LOCAL_AI_MODEL=gpt-oss-20b
LOCAL_AI_API_KEY=
```

Не создавайте `.env.local-ai` в подключаемом проекте. Launcher всегда загружает его из общей установки.

Проверьте retrieval и соединение:

```bash
cd "$IONA_HOME"
npm run ai:doctor
npm run ai:smoke
```

### Подготовить Docker Executor

```bash
cd "$IONA_HOME"
npm run agent:docker:build
npm run agent:doctor
```

Base image содержит доверенный runner. Dependencies каждого target project собираются позже в отдельный image по его `package.json` и `package-lock.json`.

### Установить удобную CLI-команду

```bash
cd "$IONA_HOME"
npm link
iona --help
```

`npm link` создаёт user-scope команду `iona`, но не копирует package в каждый проект. При использовании `nvm` link относится к активной версии Node; после смены Node его может потребоваться создать заново.

## 3. Подключение проекта

Задайте путь и выполните read-only preflight:

```bash
export TARGET_PROJECT=/absolute/path/to/existing-project
iona doctor --repo "$TARGET_PROJECT"
```

`doctor` проверяет:

- версию Node и доступность npm, Git, OpenCode и Docker;
- наличие dependencies общей установки;
- обязательный footprint трёх global sources и routed references compact retrieval;
- наличие model endpoint без вывода его значения;
- canonical Git root и чистоту checkout;
- `package.json`, `package-lock.json` и внешний state root.

Команда ничего не пишет в target. Для первичной диагностики без Docker можно использовать:

```bash
iona doctor --repo "$TARGET_PROJECT" --source-only
```

Перед coding run повторите `doctor` без `--source-only`: Docker Executor является обязательной частью полного workflow.

### Собрать project runner

```bash
iona prepare "$TARGET_PROJECT"
```

При первом запуске Docker выполняет `npm ci` только по двум package manifests. Исходный код target не включается в build context. Image кэшируется по SHA-256; после изменения `package.json` или `package-lock.json` следующая команда `prepare` создаст новый image.

## 4. Запуск OpenCode

Интерактивная session:

```bash
iona opencode --repo "$TARGET_PROJECT"
```

Одноразовая задача:

```bash
iona opencode \
  --repo "$TARGET_PROJECT" \
  run "Добавь feature, тесты и проверь production build"
```

Launcher:

1. Регистрирует canonical path проекта во внешнем repository registry.
2. Запускает OpenCode из нейтрального каталога, а не из target tree.
3. Подключает настроенную локальную модель.
4. Запрещает встроенные file, edit и shell tools OpenCode.
5. Оставляет только global skills и `iona_*` MCP tools.

OpenCode автоматически создаёт run через `iona_begin`, читает target через bounded tools, отправляет validated unified diffs и выполняет allowlisted checks в Docker.

### Опциональный Visual QA

Visual tools не включены в обычную session. Для измерения DOM и сверки с PNG-макетом сначала установите Chromium общей harness, запустите target web-приложение на loopback и зарегистрируйте exact target:

```bash
cd "$HARNESS_HOME"
npx playwright install chromium
iona visual-target "$TARGET_PROJECT" http://127.0.0.1:4200 --name local-app
iona visual-baseline "$TARGET_PROJECT" /path/to/design.png --name home
iona visual-list "$TARGET_PROJECT"
```

После этого запустите отдельную opt-in session:

```bash
iona opencode --repo "$TARGET_PROJECT" --visual
```

Флаг добавляет отдельный `ionic_visual_*` MCP namespace. Browser observations, screenshots и HTML reports сохраняются во внешнем state root и не изменяют target tree или lifecycle coding run. Кроме web URL можно human-register Android WebView, iOS Simulator или существующую loopback Appium session:

```bash
iona visual-android "$TARGET_PROJECT" \
  --serial emulator-5554 --application-id com.example.app --name android-debug
iona visual-ios-sim "$TARGET_PROJECT" \
  --udid <SIMULATOR_UDID> --bundle-id com.example.app --name ios-sim
iona visual-appium "$TARGET_PROJECT" \
  --url http://127.0.0.1:4723 --session-id <SESSION_ID> --platform ios --name ios-device
```

Полный workflow, platform prerequisites, capability matrix, ограничения и eval-команда описаны в [руководстве по Visual QA](visual-debugging.md).

## 5. Review, approval и применение результата

OpenCode сообщает `repositoryId`, `runId`, status и validation result. Сохраните эти идентификаторы до завершения работы.

### Protected patch

Изменения dependencies, tooling, native platform, CI и защищённой конфигурации требуют отдельного решения человека. При status `waiting_approval` OpenCode выводит `approvalId` и точные paths.

Просмотрите diff и одобрите или отклоните запрос вне OpenCode:

```bash
iona status <repository-id> <run-id> --include-patch
iona approve <repository-id> <approval-id> --actor <name>
# или
iona reject <repository-id> <approval-id> --actor <name>
```

После approval попросите OpenCode повторить идентичный patch. Изменённый patch не сможет использовать старое разрешение.

### Готовый patch

Когда `finish` выполнил полный validation profile и status стал `ready`, ещё раз просмотрите sealed diff:

```bash
iona status <repository-id> <run-id> --include-patch
```

Применить его к primary checkout:

```bash
iona apply <repository-id> <run-id>
```

Перед применением harness проверяет чистоту checkout, исходный `HEAD`, успешную validation evidence и SHA-256 sealed patch. Harness не создаёт commit и не выполняет push: после `apply` разработчик делает обычный review, commit и push средствами целевого проекта.

Ненужный run удаляется командой:

```bash
iona discard <repository-id> <run-id>
```

## 6. Где появляются данные

| Расположение                                             | Содержимое                                              | Попадает в target Git |
| -------------------------------------------------------- | ------------------------------------------------------- | --------------------: |
| Общая установка harness                                  | Policy, prompts, MCP server, profiles и `.env.local-ai` |                   нет |
| `~/.agents/skills`                                       | Global skill packages                                   |                   нет |
| `~/.local/share/iona`                                    | Registry, runs, approvals и detached worktrees          |                   нет |
| Docker                                                   | Base runner и project dependency images                 |                   нет |
| `.git/worktrees` целевого repository во время active run | Служебная регистрация внешнего Git worktree             |                   нет |
| Primary checkout target                                  | Только явно применённый sealed patch                    |                    да |

Harness не создаёт в target tree `ai/`, `scripts/`, `.agents/`, `opencode.json`, Dockerfile, logs или state files. Project-local agent instructions не получают автоматического доверия. Нужные общие правила добавляются в profile/prompt общей установки либо явно формулируются в задаче.

## 7. Работа без `npm link`

Все операции доступны непосредственно через установленный repository harness:

```bash
npm --prefix "$IONA_HOME" run harness:doctor -- --repo "$TARGET_PROJECT"
npm --prefix "$IONA_HOME" run harness -- prepare "$TARGET_PROJECT"
npm --prefix "$IONA_HOME" run opencode -- --repo "$TARGET_PROJECT"
```

Human-only команды также можно выполнить так:

```bash
npm --prefix "$IONA_HOME" run harness -- \
  status <repository-id> <run-id> --include-patch
```

Этот вариант удобен для CI-like workstation setup или когда global npm links запрещены policy.

## 8. Несколько проектов

Одна установка может обслуживать несколько repositories:

```bash
iona doctor --repo /projects/application-a
iona prepare /projects/application-a

iona doctor --repo /projects/application-b
iona prepare /projects/application-b
```

Repository ID включает нормализованное имя и hash canonical path. State, worktrees, approvals и dependency images разделены. После перемещения repository в другой каталог запустите `doctor` и `prepare` с новым path: он получит новый identity.

## 9. Пример для `scom`

```bash
export TARGET_PROJECT=/Users/<user>/Projects/scloud/scom-mobile

iona doctor --repo "$TARGET_PROJECT"
iona prepare "$TARGET_PROJECT"
iona opencode \
  --repo "$TARGET_PROJECT" \
  run "Реализуй отдельную feature, добавь тесты и выполни full validation"
```

После `ready`:

```bash
iona status <repository-id> <run-id> --include-patch
iona apply <repository-id> <run-id>
git -C "$TARGET_PROJECT" diff --check
git -C "$TARGET_PROJECT" status --short
```

## 10. Обновление общей установки

Обновление выполняется один раз, а не в каждом target:

```bash
cd "$IONA_HOME"
git pull --ff-only
npm ci
npm link
npx skills check
npm run verify
npm run agent:docker:build
```

Перед обновлением завершите или discard active runs. Если policy, runner или profile изменились, создавайте новые runs после повторного `doctor` и `prepare`; не переносите approval между версиями.

## 11. Частые проблемы

### `Target checkout contains uncommitted changes`

Закончите текущую работу: commit или осознанный stash. Harness начинает run только от committed `HEAD` и не смешивает пользовательский diff с model patch.

### `Skill ... is missing`

Переустановите полный package по командам из [руководства по skills](required-skills.md). Одного `SKILL.md` недостаточно — нужны routed references.

### `OpenCode is not installed`

Установите OpenCode или укажите абсолютный executable через `OPENCODE_BIN` в окружении общей установки. После смены Node через `nvm` проверьте `npm link` повторно.

### `LOCAL_AI_BASE_URL is missing` или модель недоступна

Редактируйте только `$IONA_HOME/.env.local-ai`, затем выполните `npm run ai:smoke` в общей установке. Проверяйте отдельно endpoint и MCP/Docker: это независимые соединения.

### `Docker Executor` или project runner недоступен

Запустите Docker daemon, затем:

```bash
cd "$IONA_HOME"
npm run agent:docker:build
iona prepare "$TARGET_PROJECT"
```

### `npm ci` не проходит в project runner

Проверьте соответствие `package.json` и `package-lock.json` и совместимость dependencies с Linux/Node 26. Текущий build context намеренно содержит только package manifests, runner и Dockerfile: `.npmrc` и registry credentials в него не передаются. Поэтому private dependencies пока требуют отдельного доверенного механизма BuildKit secret в общей реализации harness; не копируйте credentials в target или Dockerfile. Network отключается уже во время выполнения coding checks.

### Full validation не проходит

Текущий профиль обязательно выполняет `npm run build` и `npm test -- --watch=false`. `format:check` и `cap:check` запускаются при наличии. Исправьте target scripts или создайте подходящий профиль в общей установке harness.

### Run больше не нужен

Используйте `iona discard ...`. Не удаляйте external worktree вручную: команда согласованно очищает Git worktree registry и state run.

---

← [Обязательные skills](required-skills.md) · [Архитектура внешнего режима →](external-projects-and-opencode.md)
