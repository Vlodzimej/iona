# Visual debugging и сверка с макетами

[Harness](README.md) · [Покрытие skills](skill-coverage.md) · [Внешние проекты](external-projects-and-opencode.md) · [Безопасность](../security.md)

## Текущий статус

В текущей реализации visual debugging **не поддерживается**.

Доступные `ionic_harness_*` MCP tools умеют читать ограниченный текст, искать, применять unified diff и запускать allowlisted checks. Они не умеют:

- подключаться к DOM/WebView запущенного приложения;
- получать bounding boxes, computed styles или accessibility tree;
- управлять Xcode Simulator, Android Emulator или физическим устройством;
- делать screenshots;
- читать binary image files из target;
- сравнивать screenshot с PNG/JPEG-макетом;
- отправлять изображения модели через текущий text-only request protocol.

Skills `debugging-capacitor`, `ios-android-logs`, `ionic-design` и `capacitor-testing` дают инструкции и методику, но не добавляют инструментальных полномочий. Browser control, доступный Codex desktop, также не является частью OpenCode/local-model harness.

## Что можно добавить

Visual QA следует реализовать как отдельный controlled tool layer, а не как разрешение произвольного browser/ADB/shell access.

Предлагаемый MCP surface:

| Tool                  | Назначение                                             | Ограничение                                                             |
| --------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `visual_open`         | Открыть зарегистрированный loopback URL или app target | Только human-registered target, без произвольной сети                   |
| `visual_dom_snapshot` | Получить DOM, accessibility tree и computed layout     | Bounded nodes/properties; redaction inputs, tokens и private text       |
| `visual_screenshot`   | Сделать screenshot viewport/device                     | Фиксированные device profiles и внешний artifact directory              |
| `visual_measure`      | Измерить размеры, gaps, overflow и touch targets       | Детерминированные правила и числовой результат                          |
| `visual_compare`      | Сравнить screenshot с зарегистрированным макетом       | Exact asset ID, scale/alignment policy, thresholds и bounded image size |
| `visual_report`       | Создать standalone HTML report                         | Без credentials, hidden reasoning, endpoint URL и непроверенного HTML   |

Модель получает только структурированные observations: selectors, rectangles, CSS properties, rule violations и безопасные ссылки на artifacts. Browser/device process остаётся под контролем harness.

## Web/Ionic режим

Для web build или `ionic serve` возможен наиболее полный анализ:

1. Harness запускает заранее определённый build/serve profile на loopback.
2. Playwright/CDP открывает зарегистрированный URL с фиксированным viewport и device scale factor.
3. Controller собирает DOM, computed styles, bounding rectangles и accessibility snapshot.
4. Детерминированные проверки выявляют overflow, overlap, clipping, неожиданный scroll, слишком маленькие touch targets и расхождение spacing.
5. Screenshot и measurement JSON сохраняются вне target repository.

Такой режим может точно сообщить, например, что фактическая кнопка имеет `42×40 px` вместо ожидаемых `48×48 px`, либо что gap отличается от макета на `6 px`.

## Android

Для Android нужны два независимых канала:

- screenshot emulator/device через доверенный wrapper над `adb`;
- WebView DOM через Chrome DevTools Protocol после регистрации точного app/device target.

Нельзя отдавать модели полный `adb` или список всех подключённых устройств. Human-facing controller выбирает application ID и serial, а MCP получает только opaque target ID. Установка APK, выдача permissions и изменение device state должны оставаться protected actions.

## iOS

Для iOS Simulator можно безопасно начать со screenshots через `simctl`. Получение DOM WKWebView требует отдельного adapter к Web Inspector/Safari tooling и не должно подменяться произвольным управлением Xcode.

Для physical device дополнительно нужны signing, trust и privacy boundaries. Harness не должен автоматически читать другие приложения, device logs или содержимое экрана вне зарегистрированного target.

## Сверка с изображением макета

Макет должен сначала регистрироваться человеком как внешний immutable artifact. Не следует разрешать модели выбирать произвольный файл из filesystem.

Детерминированный pipeline:

1. Проверить MIME, dimensions, размер и отсутствие metadata, которое не нужно для сравнения.
2. Нормализовать viewport, device scale factor, color profile и safe area.
3. Выровнять screenshot и baseline по явно заданной стратегии; не растягивать молча.
4. Рассчитать pixel diff и perceptual metric, сформировать heatmap/overlay.
5. Отдельно сравнить DOM measurements с ожидаемыми regions/tokens, если они заданы.
6. Вывести threshold, ignored masks, mismatch percentage и список самых больших отклонений.

Vision-capable model можно добавить как вторичный semantic reviewer, но не как единственный gate. Текущий `gpt-oss-20b` harness получает текстовый prompt и не анализирует raw images. Даже при multimodal provider итоговый pass/fail должен опираться на воспроизводимые measurements и thresholds.

## Предлагаемый HTML-отчёт

Standalone report должен содержать:

- target/profile/viewport без сетевых endpoint details;
- baseline, actual screenshot, overlay и heatmap;
- mismatch percentage и выбранные thresholds;
- таблицу DOM элементов: selector, expected/actual rectangle, delta;
- overflow, overlap, accessibility и touch-target violations;
- platform/browser/device metadata, необходимую для воспроизведения;
- ссылки на run ID и validation evidence.

Artifacts следует хранить под внешним state root, например `~/.local/share/ionic-llm-harness/repositories/<id>/visual-runs/<run-id>`, а не в target repository. Публикация отчёта должна быть отдельным человеческим действием, потому что screenshots могут содержать пользовательские данные.

## Этапы реализации

1. Web-only Playwright/CDP adapter и fixed device profiles.
2. DOM measurements, accessibility rules и screenshot artifacts.
3. Baseline asset registry, pixel/perceptual diff и HTML report.
4. Android Emulator screenshot + WebView CDP adapter.
5. iOS Simulator screenshots.
6. WKWebView DOM adapter после отдельного security review.
7. Опциональный multimodal reviewer и eval dataset с намеренно внесёнными layout defects.

До реализации этих этапов harness может исправлять SCSS по коду и текстовым observations человека, но не может самостоятельно доказать визуальное соответствие запущенного приложения макету.

---

← [Покрытие skills](skill-coverage.md) · [Безопасность →](../security.md)
