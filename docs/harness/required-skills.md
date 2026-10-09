# Обязательные global skills

[Harness](README.md) · [Покрытие этапов разработки](skill-coverage.md) · [Подключение проектов](using-with-existing-projects.md) · [Внешние проекты](external-projects-and-opencode.md) · [OpenCode](../opencode.md)

Harness и OpenCode используют только user-scope каталог `~/.agents/skills`. Skills не входят в target project, не копируются в него и читаются заново при каждом запросе.

## Обязательные источники

| Источник                                                                                    | Область                                                                                    | Установка                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| [`angular/skills`](https://github.com/angular/skills)                                       | Angular architecture, components, signals, forms, routing, HTTP, testing и SCSS            | `npx skills add angular/skills@angular-developer -g -y`  |
| [`erkamyaman/ionic-capacitor-skills`](https://github.com/erkamyaman/ionic-capacitor-skills) | Ionic features, shared native concerns, auth/backends, analytics и app UX                  | `npx skills add erkamyaman/ionic-capacitor-skills -g -y` |
| [`Cap-go/capgo-skills`](https://github.com/Cap-go/capgo-skills)                             | Capacitor plugins, native debugging, quality, security, CI/CD, stores, releases и upgrades | `npx skills add Cap-go/capgo-skills -g -y`               |

Установить все packages на уровне пользователя:

```bash
npx skills add angular/skills@angular-developer -g -y
npx skills add erkamyaman/ionic-capacitor-skills -g -y
npx skills add Cap-go/capgo-skills -g -y
```

Команды для двух repository sources устанавливают все найденные в них skills, а не один выбранный каталог. Skills CLI может дополнительно сообщать об агентах, которые не поддерживают global installation; для harness важен успешный target `~/.agents/skills`. Итог проверяется через `doctor`.

Если вывод содержит `PromptScript does not support global skill installation`, но одновременно показывает успешное копирование в `~/.agents/skills`, это относится к другому обнаруженному agent target. Источником истины для этого harness остаётся результат `iona doctor`. Отдельный upstream manifest с ошибкой YAML может быть пропущен менеджером; harness не добавляет такой файл вручную и не включает его в обязательный footprint до исправления source package.

## Два уровня использования

### Compact retrieval локальной модели

Read-only model harness автоматически добавляет в prompt только небольшой allowlist:

- `angular-developer` — Angular и component styling/SCSS;
- `capacitor-plugins` — official-first plugin selection и Capgo fallback;
- `ionic-native-essentials` — Camera, Filesystem, Share, Haptics, Network и Keyboard;
- `ionic-deep-links` — URL schemes, Universal Links и Android App Links.

Из каждого skill берётся короткий manifest excerpt и только релевантные reference chunks. Это сохраняет контекст `gpt-oss-20b` компактным.

### Динамический выбор OpenCode

OpenCode видит остальные global skills и загружает их только по соответствующей задаче. Например:

- `debugging-capacitor` и `ios-android-logs` — Xcode, Android Studio, devices и crash logs;
- `capacitor-testing`, `capacitor-security`, `capacitor-performance`, `capacitor-accessibility` — quality gates;
- `capacitor-ci-cd`, `capacitor-app-store`, `capacitor-apple-review-preflight` — delivery;
- `ionic-design` и `safe-area-handling` — Ionic UI, SCSS и native layout;
- `ionic-firebase`, `ionic-supabase`, `ionic-sentry`, `ionic-analytics` — task-specific integrations.

Полная матрица приведена в [покрытии этапов разработки](skill-coverage.md). Загружать все manifests одновременно нельзя: это ухудшает retrieval и расходует context window.

## Проверка установки

```bash
npx skills check
iona doctor --repo /absolute/path/to/project --source-only
```

`doctor` читает package contract и retrieval allowlist из harness-owned `ai/harness.json`. Для каждого source он проверяет обязательные manifests, затем отдельно проверяет allowlisted manifests и routed references.

Ожидаемая структура является плоской по именам skills:

```text
~/.agents/skills/
├── angular-developer/
├── ionic-native-essentials/
├── ionic-deep-links/
├── capacitor-plugins/
├── debugging-capacitor/
├── ios-android-logs/
└── ...
```

Нужны полные каталоги вместе с `references/`, если package их содержит. Копии одного `SKILL.md` недостаточно.

## Source of truth

- Фактически установленное содержимое `~/.agents/skills` — user-scope dependency.
- `skillPackages` в `ai/harness.json` — минимальный проверяемый footprint каждого global repository package.
- `skills` в `ai/harness.json` — узкий trust allowlist compact retrieval локальной модели.
- User-scope lock менеджера skills может фиксировать происхождение и обновления, но target repository не должен содержать `.agents/` или `skills-lock.json`.
- Project-local skills не заменяют global installation и не получают автоматического доверия.
- Generic scaffold assumptions из внешнего skill применяются только по явной задаче и не переопределяют target versions, repository conventions или harness policy.

Обновить установленные packages:

```bash
npx skills check
npx skills update
iona doctor --repo /absolute/path/to/project --source-only
```

---

← [Извлечение контекста](context-retrieval.md) · [Покрытие этапов разработки →](skill-coverage.md)
