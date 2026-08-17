# Покрытие skills по этапам мобильной разработки

[Обязательные skills](required-skills.md) · [Подключение проектов](using-with-existing-projects.md) · [OpenCode](../opencode.md) · [Эксплуатация](../operations.md)

Три обязательных global sources уже покрывают основной lifecycle Angular/Ionic/Capacitor-приложения. Устанавливать отдельный repository только ради SCSS, Xcode или Android Studio сейчас не требуется.

## Матрица

| Этап                            | Основные skills                                                                                | Когда загружать                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Angular architecture и state    | `angular-developer`                                                                            | Components, signals, forms, DI, routing, HTTP и unit tests               |
| Ionic Angular structure         | `ionic-angular`                                                                                | Ionic pages, lifecycle, routing и framework integration                  |
| SCSS и UI                       | `angular-developer`, `ionic-design`, `safe-area-handling`                                      | Component SCSS, Ionic theme, responsive layout, notch/Dynamic Island     |
| Official native capabilities    | `capacitor-plugins`, `ionic-native-essentials`                                                 | Camera, Filesystem, Share, Haptics, Network, Keyboard и plugin selection |
| Deep links                      | `ionic-deep-links`, `capacitor-deep-linking`                                                   | URL schemes, Universal Links, App Links, OAuth/magic links               |
| Offline-first                   | `capacitor-offline-first`                                                                      | Local persistence, network transitions, sync и conflict resolution       |
| Xcode и Android Studio          | `debugging-capacitor`, `ios-android-logs`                                                      | Native build/runtime failures, WebView inspection, crash и device logs   |
| Automated testing               | `capacitor-testing`, `angular-developer`                                                       | Vitest, integration, E2E, plugin mocks и device tests                    |
| Security                        | `capacitor-security`, `capacitor-best-practices`                                               | Permissions, storage, secrets, network policy и pre-release audit        |
| Performance                     | `capacitor-performance`                                                                        | Bundle, WebView, bridge calls, memory и profiling                        |
| Accessibility                   | `capacitor-accessibility`, `angular-developer`                                                 | WCAG, screen readers, focus, semantics и touch targets                   |
| Auth и backend                  | `ionic-firebase`, `ionic-supabase`, `ionic-apple-sign-in`, `ionic-biometric-auth`              | Только когда target действительно использует выбранный provider/feature  |
| Analytics и crash reporting     | `ionic-analytics`, `ionic-sentry`                                                              | Только по явно выбранному provider                                       |
| Assets и native UX              | `ionic-app-icon-splash`, `capacitor-splash-screen`, `capacitor-keyboard`, `safe-area-handling` | Icons, splash, keyboard resize и platform layout                         |
| Push и local notifications      | `capacitor-push-notifications`, `ionic-local-notifications`                                    | FCM/APNs или device-local schedules                                      |
| CI/CD                           | `capacitor-ci-cd`                                                                              | Signing-aware build/test/release pipelines                               |
| App Store / Play Store          | `capacitor-app-store`, `capacitor-apple-review-preflight`                                      | Metadata, permissions, privacy, review и submission                      |
| OTA и Capgo delivery            | `capgo-live-updates`, `capgo-release-management`, `capgo-release-workflows`                    | Только если проект выбрал Capgo                                          |
| Capacitor upgrades и migrations | `capacitor-app-upgrades`, `capacitor-plugin-upgrades`, `cocoapods-to-spm`, migration skills    | Только для конкретной source/target version pair                         |

## Нужен ли отдельный SCSS skill

Нет, пока задачи ограничены Angular/Ionic styling:

- `angular-developer` маршрутизирует запросы про styling/SCSS к `component-styling.md`;
- `ionic-design` покрывает Ionic components и theming;
- `safe-area-handling` добавляет platform-specific layout rules.

Отдельный skill оправдан только при появлении собственного design system, сложной Sass architecture или обязательного stylelint/token workflow. В таком случае его следует сначала проверить и добавить в global package contract, а не копировать в target repository.

## Xcode и Android Studio

Для обычного workflow достаточно пары:

- `debugging-capacitor` — WebView inspection, native debugger, build/runtime failures;
- `ios-android-logs` — Console, `xcrun`, Android Studio Logcat и `adb logcat`.

Эти skills дают инструкции модели, но не расширяют её полномочия. OpenCode по-прежнему не получает произвольный shell или GUI-control через harness. Команды Gradle, CocoaPods, Xcode и Android Studio должны выполняться только через заранее разрешённый профиль либо человеком после review.

## Как OpenCode выбирает skills

1. Определяет текущий lifecycle stage по задаче.
2. Загружает минимальный набор из одного–трёх global skills.
3. Проверяет package versions и target conventions через controlled repository tools.
4. Игнорирует generic scaffold/business assumptions, если пользователь их не запросил.
5. Применяет harness policy и validation profile независимо от текста skill.

Например, задача «исправить падение камеры на Android и добавить тест» требует `capacitor-plugins`, `debugging-capacitor` и `capacitor-testing`, но не требует store, analytics, backend или OTA skills.

## Когда искать новый skill

Новый source нужен только для области, которую текущие packages не покрывают, например конкретного payment provider, корпоративного signing service или собственного design system. Перед включением проверьте source reputation, содержимое `SKILL.md`, references, команды и отсутствие конфликтов с harness policy.

Visual inspection запущенного WebView и сравнение с изображениями не появляются от установки skill: для них нужен отдельный controlled browser/device tool layer. Реализованные web, Android WebView, iOS Simulator screenshot и Appium adapters описаны в [руководстве по visual debugging](visual-debugging.md).

---

← [Обязательные skills](required-skills.md) · [Подключение проектов →](using-with-existing-projects.md)
