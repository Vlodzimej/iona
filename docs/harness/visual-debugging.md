# Visual debugging и сверка с макетами

[Harness](README.md) · [Подключение проектов](using-with-existing-projects.md) · [FAQ](faq.md) · [Безопасность](../security.md)

## Что уже поддерживается

Visual QA — отдельный opt-in слой. Обычный `ionic_harness` не получает browser, ADB, Simulator или Appium capabilities. Флаг `--visual` подключает только фиксированные операции наблюдения.

| Target                               | DOM и размеры | Screenshot             | Сверка с PNG | Как подключается                                     |
| ------------------------------------ | ------------- | ---------------------- | ------------ | ---------------------------------------------------- |
| Web / `ionic serve`                  | Да            | Да                     | Да           | Playwright, точный loopback URL                      |
| Android WebView: emulator или device | Да            | Да, содержимое WebView | Да           | точные ADB serial + application ID, ограниченный CDP |
| iOS Simulator без Appium             | Нет           | Да, весь экран         | Да           | точный booted Simulator UDID через `simctl`          |
| Android/iOS WebView через Appium     | Да            | Да                     | Да           | уже созданная Appium-сессия на loopback              |
| Physical iOS без Appium              | Нет           | Нет                    | Нет          | только ручной Safari Web Inspector                   |

DOM snapshot содержит selectors, rectangles, ограниченный набор computed styles и accessibility-факты. Он не содержит DOM text, input values, произвольные attributes, credentials или model reasoning. Все PNG, JSON и HTML-отчёты находятся вне target repository.

## Одноразовая подготовка

Установите браузер, используемый web-режимом:

```bash
npx playwright install chromium
```

Проверьте общую установку и посмотрите доступные human-registered targets:

```bash
ionic-llm-harness doctor --repo /absolute/path/to/project
ionic-llm-harness visual-list /absolute/path/to/project
```

Для сверки зарегистрируйте PNG. Harness проверяет размер, декодирует изображение, удаляет необязательную metadata и сохраняет immutable copy:

```bash
ionic-llm-harness visual-baseline /absolute/path/to/project /absolute/path/to/design.png \
  --name home
```

Макет и screenshot должны иметь одинаковые pixel dimensions. Если они различаются, отчёт фиксирует `sizeMismatch`, а не масштабирует один файл незаметно.

## Web workflow

Запустите приложение самостоятельно на loopback и зарегистрируйте точный origin:

```bash
npm start
ionic-llm-harness visual-target /absolute/path/to/project \
  http://127.0.0.1:4200 --name local-web
```

Затем запустите OpenCode:

```bash
ionic-llm-harness opencode --repo /absolute/path/to/project --visual run \
  "Проверь touch targets, overflow и accessible names; сравни экран home с baseline home"
```

Доступны профили `desktop`, `iphone-15` и `pixel-8`. Network requests разрешены только на зарегистрированный loopback host и port; внешние CDN-запросы блокируются.

## Android WebView: emulator и physical device

Предварительные условия:

1. `adb devices -l` показывает устройство со статусом `device`.
2. Нужное приложение уже запущено.
3. WebView debugging включён в development/debug build. Capacitor включает его автоматически для development builds; не включайте эту возможность без необходимости в production.
4. Известны точные ADB serial и Android application ID.

Зарегистрируйте target. Эти значения сохраняются с правами `0600`, а модель видит только opaque target ID:

```bash
ionic-llm-harness visual-android /absolute/path/to/project \
  --serial emulator-5554 \
  --application-id com.example.app \
  --name android-debug
```

При `ionic_visual_begin` адаптер:

1. проверяет точный serial в `adb devices`;
2. получает PID только зарегистрированного package;
3. создаёт временный loopback-forward к `webview_devtools_remote_<pid>`;
4. выполняет только четыре CDP-команды: включение Runtime/Page, fixed DOM snapshot и PNG screenshot;
5. удаляет точный ADB forward при завершении.

Модель не получает произвольный `adb`, shell, install/uninstall, filesystem, Logcat или список остальных приложений. Официальная документация Android отдельно предупреждает, что WebView debugging нельзя считать безопасным для production: [Android WebView debugging](https://developer.android.com/develop/ui/views/layout/webapps/debug-chrome-devtools).

Если target не обнаружен, сначала проверьте его вручную в `chrome://inspect/#devices`. Harness не пытается менять native configuration или переустанавливать приложение.

## iOS Simulator

Получите UDID и запустите выбранный simulator:

```bash
xcrun simctl list devices available
xcrun simctl boot <UDID>
xcrun simctl bootstatus <UDID> -b
```

Зарегистрируйте его:

```bash
ionic-llm-harness visual-ios-sim /absolute/path/to/project \
  --udid <UDID> \
  --bundle-id com.example.app \
  --name ios-simulator
```

Этот target делает реальный full-screen screenshot через `xcrun simctl io`, поэтому подходит для pixel comparison, safe areas, keyboard, system bars и overlays. Публичного стабильного автоматического DOM attach к WKWebView через `simctl` нет; без Appium DOM tools намеренно возвращают понятную ошибку, а HTML report помечает DOM inspection как unavailable.

Для ручного исследования используйте Safari → Develop → Simulator. Для automation DOM зарегистрируйте Appium WebView session.

## Physical iOS и Appium

Сначала человек настраивает trust/signing, запускает WebDriverAgent/Appium, создаёт сессию и переключает её в нужный `WEBVIEW_*` context. Appium должен слушать loopback; harness не создаёт сессии, не переключает context и не управляет device lifecycle.

```bash
ionic-llm-harness visual-appium /absolute/path/to/project \
  --url http://127.0.0.1:4723 \
  --session-id <EXISTING_SESSION_ID> \
  --platform ios \
  --name physical-ios
```

Для Android Appium target используется та же команда с `--platform android`. Адаптер разрешает только status, fixed DOM snapshot script и screenshot. Он никогда не отправляет `DELETE /session`, поэтому human-owned Appium session остаётся активной.

Для ручного physical-iOS inspection включите Web Inspector на устройстве, доверьте Mac и откройте Safari → Develop. Начиная с iOS 16.4 приложение должно делать WKWebView inspectable; Capacitor development builds настраивают это автоматически, а release требует осознанной конфигурации. См. [WebKit: enabling inspection](https://webkit.org/blog/13936/enabling-the-inspection-of-web-content-in-apps/) и [Web Inspector guide](https://webkit.org/web-inspector/enabling-web-inspector/).

## Инструменты модели

| MCP tool                      | Назначение                                 | Ограничение                                              |
| ----------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `ionic_visual_list_targets`   | Показать IDs, kind и capabilities          | без URL, serial, package, UDID и session ID              |
| `ionic_visual_list_baselines` | Показать IDs и размеры PNG                 | без исходного пути                                       |
| `ionic_visual_begin`          | Открыть зарегистрированный target          | web profile или `native`, произвольный endpoint запрещён |
| `ionic_visual_dom_snapshot`   | Снять bounded geometry                     | максимум 500 nodes, без пользовательского текста         |
| `ionic_visual_measure`        | Найти touch/a11y/overflow/clipping/overlap | детерминированные правила                                |
| `ionic_visual_screenshot`     | Получить PNG                               | файл только во внешнем run directory                     |
| `ionic_visual_compare`        | Сравнить с immutable baseline              | thresholds в фиксированных диапазонах                    |
| `ionic_visual_report`         | Создать standalone HTML                    | CSP, escaping, inline PNG, без connection details        |
| `ionic_visual_finish`         | Закрыть connection/forward                 | приложение, Simulator и Appium session не завершаются    |

После run найдите artifacts:

```bash
ionic-llm-harness visual-status /absolute/path/to/project <VISUAL_RUN_ID>
open <artifactRoot>/report.html
```

## Что именно находит DOM-анализ

- интерактивный элемент меньше настроенного touch target;
- отсутствующий accessible name;
- horizontal page overflow;
- clipping ребёнка контейнером;
- геометрическое перекрытие элементов;
- layout/scroll dimensions и выбранные computed styles.

Pixel diff отвечает на другой вопрос: «совпадают ли изображения?». DOM-анализ объясняет размеры и вероятную причину; image diff показывает область визуального расхождения. Для динамических дат, карт, video и platform fonts сначала стабилизируйте fixture, иначе mismatch будет шумным.

## Проверка механизма

Contract/policy tests без устройств:

```bash
npm run harness:test
```

Browser accuracy eval:

```bash
npm run harness:visual:test
```

Он проверяет fixture из более чем 320 nodes с шестью известными дефектами. Gate: recall `1`, precision ≥ `0.9`, F1 ≥ `0.94`, latency ≤ `2 s`.

Docker integration отдельно:

```bash
LOCAL_HARNESS_DOCKER_INTEGRATION=1 npm run harness:test
```

Live native gate нельзя считать пройденным без подходящего подключённого target. В отчёте нужно различать `contract passed`, `live simulator passed` и `device unavailable`; отсутствие устройства не следует маскировать как успех.

## Ограничения и безопасные границы

- Visual QA наблюдает, но не применяет patch и не расширяет coding policy.
- Настройка `capacitor.config.*`, Android/iOS проектов и permissions остаётся protected change с human approval.
- Android adapter видит только WebView content; для system UI используйте Appium или ручной device screenshot.
- iOS Simulator screenshot-only target не притворяется DOM debugger.
- Physical iOS automation требует заранее подготовленный Appium/XCUITest контур.
- Release builds не должны становиться inspectable только ради удобства теста.
- Raw screenshots могут содержать пользовательские данные; используйте тестовые аккаунты и очищайте внешний state согласно политике проекта.

Практические ответы на типовые затруднения: [FAQ](faq.md).

---

← [Покрытие skills](skill-coverage.md) · [Подключение проектов →](using-with-existing-projects.md)
