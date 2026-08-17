# FAQ по harness

[Документация](../README.md) · [Быстрый старт](../getting-started.md) · [Подключение проектов](using-with-existing-projects.md) · [Visual QA](visual-debugging.md)

## Основные понятия

### Harness, OpenCode и локальная модель — это одно и то же?

Нет. `gpt-oss-20b` предлагает решение, OpenCode ведёт многошаговый диалог и выбирает tools, а harness определяет доступный контекст, разрешённые действия, изоляцию, approvals и обязательные проверки. Полномочия принадлежат controller, а не модели.

### Можно ли считать harness полностью автономным разработчиком?

Нет. Он уже пригоден как контролируемый ассистент: читает разрешённые файлы, готовит patch в отдельном worktree и проверяет его. Человек по-прежнему формулирует задачу, одобряет protected changes, просматривает diff и отдельно применяет результат.

### Почему skills находятся в `~/.agents/skills`, а не в проекте?

Одна проверяемая user-scope установка обслуживает много проектов, не засоряет их файлами harness и не превращает project content в автоматически доверенные инструкции. `doctor` проверяет обязательный footprint, а retrieval загружает только нужные fragments.

### Нужно ли коммитить `skills-lock.json` или `.agents/skills` в target repository?

Нет. Для этого режима target repository не содержит skills. Происхождение и обновление user-scope packages контролируются общей установкой; обязательные source packages перечислены в `ai/harness.json` и [руководстве по skills](required-skills.md).

## Подключение и запуск

### Можно ли использовать harness в уже существующем проекте без копирования `ai/` и `scripts/`?

Да. Один раз выполните `npm link` в общей установке, затем запускайте `ionic-llm-harness ...` из любого Git-проекта. Prompt, policy, MCP, Dockerfile, state и worktrees остаются снаружи.

### Почему `doctor` требует чистый Git checkout?

Run привязывается к точному committed `HEAD`. Это позволяет отделить patch модели от незавершённых человеческих изменений, проверить sealed hash и безопасно применить результат. Сначала закоммитьте или временно уберите собственные изменения.

### Почему нужен `package-lock.json`?

Project-specific Docker runner устанавливает ровно зафиксированные npm dependencies. Без lockfile сборка не воспроизводима. Для другого package manager нужен отдельный versioned profile и runner.

### Почему первый `prepare` дольше последующих?

Он строит dependency image по hash `package.json`, `package-lock.json`, Dockerfile и trusted runner. Следующие запуски используют cache, пока эти inputs не изменятся. Системный слой берётся из заранее собранного base runner, поэтому не переустанавливается для каждого проекта.

### Harness не видит LM Studio по адресу другого компьютера. Что проверить?

Проверьте, что LM Studio слушает LAN interface, firewall разрешает порт, URL заканчивается на `/v1`, а с машины harness доступны `/v1/models` и Chat Completions. Значение храните только в ignored `.env.local-ai`, например `LOCAL_AI_BASE_URL=http://192.168.x.x:1234/v1`. Затем запустите `npm run ai:smoke`.

### Может ли модель выполнить произвольную shell-команду?

Нет. OpenCode built-in file/shell tools запрещены enforced configuration. Docker Executor принимает только versioned command arrays из profile; текст shell из ответа модели не исполняется.

### Что делать, если OpenCode долго не вызывает `ionic_harness_begin`?

Для тестовых и CI-запусков добавьте `--timeout-seconds 900`. Сообщение о недоступном skill `ionic-harness` означает ошибку выбора tool: harness — это MCP surface, а не skill. Такой прогон не считается успешным. Если `begin` уже вернул run ID, проверьте его через `status` и удалите через `discard`; если до `begin` дело не дошло, run ещё не существует. Затем освободите очередь LM Studio и повторите запуск.

Launcher сам проверяет postcondition команды `run`: должен появиться ровно один новый run в состоянии `ready` или `waiting_approval`. Поэтому нулевой exit code OpenCode больше не скрывает напечатанный вместо вызванного `finish`.

## Изменения и безопасность

### Где модель изменяет код?

Только во внешнем detached Git worktree. Primary checkout не меняется до human-only команды `ionic-llm-harness apply`.

### Что такое protected approval?

Это одноразовое разрешение на точный patch, затрагивающий чувствительные области: package/tooling configuration, native projects, CI и другие protected paths. Approval связан с run ID, hash аргументов, capability, paths и сроком действия. Изменённый patch требует нового решения.

### Делает ли harness commit или push?

Нет. Он может подготовить, проверить и применить patch. Commit и push остаются обычными осознанными Git-действиями разработчика.

### Попадают ли secrets или reasoning модели в отчёты?

Нет по контракту: secret paths запрещены, environment/endpoint/API key не включаются, hidden reasoning не сохраняется. Но task text, visible model output, diff и screenshots могут быть чувствительными, поэтому внешний state нужно защищать и очищать по правилам организации.

## Visual debugging

### Может ли harness сравнить интерфейс с картинкой из Figma?

Да, если экспортировать нужный frame в PNG. Зарегистрируйте PNG как baseline. Harness сравнит pixel dimensions, рассчитает mismatch и создаст diff. Прямой импорт Figma-файла в текущий visual layer не реализован.

### Чем DOM measurement отличается от pixel diff?

DOM measurement объясняет структуру: размеры, overflow, clipping, overlap и accessibility. Pixel diff показывает, где изображение отличается от baseline, но сам по себе не объясняет причину. Лучший результат даёт их совместное использование.

### Почему screenshot и макет должны быть одного размера?

Автоматическое масштабирование скрывает ошибку viewport, device scale factor или framing. Harness фиксирует size mismatch явно. Подготовьте baseline под тот же target/profile и согласуйте, входят ли в кадр system bars.

### Можно ли анализировать Android WebView на физическом телефоне?

Да. Нужны authorized ADB device, запущенный debug/development build и точные serial/application ID. Модель получает только ограниченные DOM/screenshot operations, а не полный ADB.

### Почему Android target не находится?

Проверьте `adb devices -l`, запущен ли правильный package и виден ли WebView в `chrome://inspect`. Release build часто намеренно не inspectable. Harness не включает debugging и не переустанавливает приложение автоматически.

### Почему у iOS Simulator есть screenshot, но нет DOM?

`simctl` предоставляет стабильный screenshot channel, но не универсальный programmatic WKWebView DOM attach. Для DOM используйте заранее созданную Appium session в WebView context либо ручной Safari Web Inspector.

### Как работать с physical iOS?

Для ручной отладки используйте trusted Mac + Safari Web Inspector. Для automation подготовьте Appium/XCUITest session, переключите её в нужный `WEBVIEW_*` context и зарегистрируйте loopback endpoint/session ID. Harness не управляет signing, trust и WebDriverAgent автоматически.

### Можно ли включить WebView debugging в production?

Технически некоторые платформы это допускают, но делать так по умолчанию нельзя: inspectable content расширяет поверхность атаки. Используйте development builds и явный security review для исключений.

### Где находится HTML Visual QA report?

Выполните `ionic-llm-harness visual-status <project> <run-id>`. Команда покажет внешний `artifactRoot`; внутри находится `report.html`. В target repository отчёт не добавляется.

## Тестирование и интерпретация результатов

### Какие проверки запускать перед использованием?

Минимум: `ionic-llm-harness doctor`, `npm run ai:smoke`, `npm run harness:test`. Для browser Visual QA добавьте `npm run harness:visual:test`; для общей установки — `npm run verify`.

### Почему model eval может вернуть ненулевой exit code, хотя HTML создан?

Runner всегда старается записать HTML/JSON evidence, а затем сигнализирует failure, если хотя бы одна задача не прошла. Откройте per-task checks: высокий средний score не заменяет исправление отдельной safety/correctness ошибки.

### Как сравнивать локальную модель с Codex честно?

Используйте один frozen набор и неизменные prompts, сохраните model/runtime/commit/parameters, выполните несколько repeats и сравнивайте pass rate, grounding, safety, latency, attempts и длину. Не делайте вывод только по одному красивому ответу.

### Что означает «device unavailable»?

Contract tests адаптера прошли, но live hardware gate не выполнялся. Это не failure реализации и не доказательство live-работы. В отчёте эти состояния должны быть разделены.

### Нужно ли запускать `npx cap sync`, Xcode или Gradle после любого изменения?

Нет. Для web-only изменений это лишнее. Native sync/build нужен только при изменении native dependencies, Capacitor configuration или platform code; такие paths защищены approval policy.

---

← [Harness](README.md) · [Visual QA →](visual-debugging.md)
