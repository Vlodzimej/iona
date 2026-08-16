# Visual debugging и сверка с макетами

[Harness](README.md) · [Покрытие skills](skill-coverage.md) · [Внешние проекты](external-projects-and-opencode.md) · [Безопасность](../security.md)

## Текущий статус

Реализован первый **web-only Visual QA milestone**:

- отдельный opt-in MCP server `ionic_visual`, не расширяющий полномочия обычного `ionic_harness`;
- подключение только к human-registered HTTP loopback URL;
- фиксированные профили `desktop`, `iphone-15` и `pixel-8`;
- bounded DOM snapshot без текста страницы и значений inputs;
- измерение touch targets, accessible names, overflow, clipping и overlap;
- viewport screenshot;
- сравнение с immutable PNG baseline, pixel diff и mismatch threshold;
- standalone HTML report во внешнем state root.

Android WebView, ADB, iOS Simulator, WKWebView и physical devices пока не поддерживаются. Текущий `gpt-oss-20b` получает только структурированные наблюдения и не анализирует raw images.

Обычный запуск OpenCode не загружает Playwright и не разрешает `ionic_visual_*`. Visual tools появляются только после явного `--visual`.

## Подготовка и запуск

После установки зависимостей общей harness один раз установите управляемый Chromium:

```bash
npx playwright install chromium
```

Запустите web-приложение самостоятельно на loopback interface, затем зарегистрируйте точный URL. URL, credentials и произвольная сеть модели не передаются:

```bash
ionic-llm-harness visual-target /path/to/project http://127.0.0.1:4200 --name local-app
```

Для сверки зарегистрируйте PNG-макет. Harness декодирует и заново записывает PNG, удаляя необязательную metadata, затем хранит immutable copy вне проекта:

```bash
ionic-llm-harness visual-baseline /path/to/project /path/to/design.png --name home
ionic-llm-harness visual-list /path/to/project
```

Включите Visual QA только для нужной OpenCode-сессии:

```bash
ionic-llm-harness opencode --repo /path/to/project --visual run \
  "Проверь размеры интерактивных элементов и сравни экран home с зарегистрированным макетом"
```

После создания report получите human-visible absolute artifact directory:

```bash
ionic-llm-harness visual-status /path/to/project VISUAL_RUN_ID
```

Файл `report.html` внутри выведенного `artifactRoot` можно открыть локально в браузере.

## Инструментальный слой

Visual QA реализован как отдельный controlled tool layer, а не как разрешение произвольного browser/ADB/shell access.

Текущий MCP surface:

| Tool                        | Назначение                                          | Ограничение                                                         |
| --------------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| `ionic_visual_begin`        | Открыть зарегистрированный loopback target          | Только opaque target ID и fixed device profile                      |
| `ionic_visual_dom_snapshot` | Получить bounded DOM и computed layout              | Не возвращает DOM text, input values или произвольные attributes    |
| `ionic_visual_screenshot`   | Сделать screenshot viewport                         | PNG во внешнем artifact directory                                   |
| `ionic_visual_measure`      | Найти overflow, clipping, overlap и a11y отклонения | Детерминированные правила и числовой результат                      |
| `ionic_visual_compare`      | Сравнить screenshot с зарегистрированным макетом    | Exact baseline ID, dimensions, thresholds и максимум 16 megapixels  |
| `ionic_visual_report`       | Создать standalone HTML report                      | CSP, HTML escaping, без endpoint URL, credentials и model reasoning |

Модель получает только структурированные observations: selectors, rectangles, CSS properties, rule violations и безопасные ссылки на artifacts. Browser/device process остаётся под контролем harness.

## Web/Ionic режим

Для web build или `ionic serve` возможен наиболее полный анализ:

1. Человек запускает приложение на loopback либо использует отдельно контролируемый serve profile.
2. Playwright открывает зарегистрированный URL с фиксированным viewport и device scale factor.
3. Controller собирает DOM geometry, ограниченный набор computed styles и accessibility facts.
4. Детерминированные проверки выявляют horizontal overflow, overlap, clipping, слишком маленькие touch targets и отсутствие accessible name.
5. Screenshot и measurement JSON сохраняются вне target repository.

Такой режим может точно сообщить, например, что фактическая кнопка имеет `42×40 px` при настроенном минимуме `44×44 px`. Expected rectangles, spacing tokens и region-level comparison относятся к следующему этапу.

## Проверка эффективности DOM-анализа

Быстрые pure/contract tests входят в обычный `npm run harness:test`. Они не требуют установленного browser binary и проверяют отсутствие регрессии базовой harness.

Реальный browser eval запускается отдельно:

```bash
npm run harness:visual:test
```

Fixture содержит более 320 элементов и шесть ожидаемых нарушений: малые touch targets в light DOM и open Shadow DOM, отсутствие accessible name, скрытый horizontal overflow, clipping и overlap. Тест выводит:

- количество проанализированных DOM nodes;
- продолжительность snapshot + analysis;
- true/false positives и false negatives;
- precision, recall и F1;
- mismatch percentage для изменённого screenshot.

Release gate требует recall `1`, precision не ниже `0.9`, F1 не ниже `0.94` и measurement latency не более `2 s`. Отдельные негативные тесты защищают от false positives на нормальном vertical document scroll и intentional scroll containers.

## Android — следующий этап

Для Android нужны два независимых канала:

- screenshot emulator/device через доверенный wrapper над `adb`;
- WebView DOM через Chrome DevTools Protocol после регистрации точного app/device target.

Нельзя отдавать модели полный `adb` или список всех подключённых устройств. Human-facing controller выбирает application ID и serial, а MCP получает только opaque target ID. Установка APK, выдача permissions и изменение device state должны оставаться protected actions.

## iOS — следующий этап

Для iOS Simulator можно безопасно начать со screenshots через `simctl`. Получение DOM WKWebView требует отдельного adapter к Web Inspector/Safari tooling и не должно подменяться произвольным управлением Xcode.

Для physical device дополнительно нужны signing, trust и privacy boundaries. Harness не должен автоматически читать другие приложения, device logs или содержимое экрана вне зарегистрированного target.

## Сверка с изображением макета

Макет сначала регистрируется человеком как внешний immutable artifact. Модель не может выбирать произвольный файл из filesystem. Текущий milestone принимает PNG; JPEG normalization остаётся следующим расширением.

Текущий детерминированный pipeline:

1. Проверить MIME, dimensions, размер и отсутствие metadata, которое не нужно для сравнения.
2. Нормализовать PNG baseline и использовать фиксированные viewport/device scale factor.
3. Требовать точного совпадения dimensions; не растягивать и не выравнивать изображение молча.
4. Рассчитать pixel diff и difference image.
5. Вывести pixel threshold, maximum mismatch percentage и фактический mismatch percentage.

Perceptual metric, masks, safe-area alignment и expected regions/tokens остаются дальнейшими расширениями.

Vision-capable model можно добавить как вторичный semantic reviewer, но не как единственный gate. Текущий `gpt-oss-20b` harness получает текстовый prompt и не анализирует raw images. Даже при multimodal provider итоговый pass/fail должен опираться на воспроизводимые measurements и thresholds.

## HTML-отчёт

Текущий standalone report содержит:

- target ID, fixed device profile и viewport без сетевых endpoint details;
- baseline, actual screenshot и difference image;
- mismatch percentage и выбранные thresholds;
- таблицу overflow, clipping, overlap, accessibility и touch-target violations;
- visual run ID и количество проанализированных DOM nodes.

Artifacts хранятся под внешним state root, например `~/.local/share/ionic-llm-harness/repositories/<id>/visual/runs/<run-id>`, а не в target repository. Публикация отчёта должна быть отдельным человеческим действием, потому что screenshots могут содержать пользовательские данные.

## Дальнейшие этапы реализации

1. ~~Web-only Playwright adapter и fixed device profiles.~~
2. ~~DOM measurements, accessibility rules и screenshot artifacts.~~
3. ~~PNG baseline registry, pixel diff и HTML report.~~
4. Добавить optional perceptual metric, masks и явно заданные expected regions/tokens.
5. Android Emulator screenshot + WebView CDP adapter.
6. iOS Simulator screenshots.
7. WKWebView DOM adapter после отдельного security review.
8. Опциональный multimodal reviewer и расширенный eval dataset.

Текущий web milestone уже даёт воспроизводимое числовое evidence. Он не доказывает semantic equivalence дизайну и не заменяет human review, особенно для typography, иллюстраций и platform-native rendering.

---

← [Покрытие skills](skill-coverage.md) · [Безопасность →](../security.md)
