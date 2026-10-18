# EngReader

Читалка EPUB для iPhone: английские книги, перевод слова по тапу, личный словарь,
карточки с интервальным повторением. Всё хранится локально, без сервера и регистрации.

Проработка (истории, крайние случаи, ADR, задачи, план проверки) — на доске Prona
«Читалка EPUB на iPhone: перевод слов, словарь, карточки».

## Стек

- Expo SDK 58 / React Native 0.88 / TypeScript (ADR-001).
- Читалка — epub.js в `react-native-webview`, JS-мост отдаёт слово, предложение и CFI (ADR-002).
- Словарь EN→RU — SQLite в приложении (`expo-sqlite`); сейчас посевной на ~90 слов,
  полный из Wiktionary — задача T-2.1 (ADR-003).
- Примеры употребления — Tatoeba API (CC BY 2.0 FR); Reverso — только веб-страница
  в in-app browser, их эндпоинт закрыт Cloudflare (ADR-004, снимки в `docs/io-samples`).
- Повторения — FSRS (`ts-fsrs`), задача T-3.2 (ADR-005).

## Что уже работает (сквозной скелет, T-0)

Библиотека с тестовой книгой («Алиса», Project Gutenberg) и импортом EPUB из «Файлов» →
чтение с листанием и настройкой шрифта → тап по слову → карточка с переводом, контекстом,
озвучкой и примерами → «В словарь» → список словаря.

## Запуск

Нужны: аккаунт Apple Developer, аккаунт Expo, iPhone с iOS 16+. Mac не нужен.

```bash
npm install
node scripts/gen-vendor.mjs          # пересобрать src/reader/vendor.generated.ts (уже в репо)
npx tsc --noEmit                     # тайпчек

# 1. Один раз: dev-client на телефон (сборка в облаке EAS, ~15 мин)
npx eas-cli@latest login
npx eas-cli@latest build --profile development --platform ios
#    установить с телефона по ссылке/QR из вывода eas

# 2. Каждый день: JS прилетает по Wi-Fi
npx expo start --dev-client

# 3. Сборка для TestFlight
npx eas-cli@latest build --profile production --platform ios
npx eas-cli@latest submit --platform ios
```

## Структура

```
App.tsx                     корень: SQLiteProvider + навигация
src/db/schema.ts            схема и миграции (PRAGMA user_version)
src/db/seedDict.ts          посевной словарь
src/reader/readerHtml.ts    страница WebView: epub.js + мост тапа
src/reader/vendor.generated.ts   epub.js и JSZip строками (генерируется)
src/lib/wordResolver.ts     нормализация, фразовые, формы, суффиксы
src/lib/examples.ts         ExamplesProvider: Tatoeba + кеш, ссылка на Reverso
src/lib/books.ts            импорт, тестовая книга, позиция чтения
src/lib/vocab.ts            личный словарь
src/screens/*               Библиотека · Чтение · Словарь
src/components/WordSheet.tsx карточка слова
docs/io-samples/            живые ответы источников (T-0b)
```

## Лицензии данных

- epub.js — BSD-2-Clause; JSZip — MIT.
- Tatoeba — предложения CC BY 2.0 FR, атрибуция автора показывается под примером.
- Тестовая книга — Project Gutenberg, public domain.
- Полный словарь (когда появится) — Wiktionary, CC BY-SA 3.0, атрибуция в экране «О приложении».
