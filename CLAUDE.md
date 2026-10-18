# CLAUDE.md — EngReader

Expo/React Native (TypeScript) приложение для iPhone: читалка EPUB с переводом по тапу,
словарём и карточками. Документация и коммиты — на русском.

## Источник истины
- Проработка и ход работ — доска Prona «Читалка EPUB на iPhone» (трек «Доставка»):
  истории US-1…US-4, задачи T-0…T-5, ADR-001…005, чек-лист приёмки. Начинай сессию
  с `board_read(op=track_state)`, статусы задач веди в карточках этапа 4.
- Решения, которые нельзя менять молча: Expo (не натив), словарь Wiktionary→SQLite
  в бандле, FSRS, примеры из Tatoeba (Reverso только веб-страницей), всё локально.
  Менять — через правку ADR на доске, потом код.

## Команды
- `npm install`; `npx expo install <pkg>` — только так добавлять зависимости.
- `npx tsc --noEmit` — тайпчек (обязателен перед коммитом). `npx expo lint`.
- `node scripts/gen-vendor.mjs` — пересобрать `src/reader/vendor.generated.ts` после обновления epub.js/JSZip.
- Сборка/запуск только через EAS и dev-client (Mac нет): см. README.

## Гочи
- Expo меняет API каждый SDK: перед кодом на expo-* сверяйся с `https://docs.expo.dev/versions/v58.0.0/`.
  expo-file-system — класс-API (`File`, `Directory`, `Paths`), не legacy.
- `vendor.generated.ts` большой (~320 КБ) и коммитится; руками не править.
- Папки `ios/`, `android/` генерируются — не создавать.
- Владелец работает с Linux-ноутбука (4 ГБ RAM): не запускать тяжёлое параллельно, следить за диском.
