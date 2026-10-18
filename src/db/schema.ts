// Схема локальной БД (SQLite на телефоне). Миграции — только вперёд, по PRAGMA user_version.
// Контракт таблиц — на доске проработки, этап 3 («Контракт локального хранения»).
// Словарь (dict_*) живёт в отдельном файле assets/dict/dict.db и подключается ATTACH — см. dictionary.ts.
import type { SQLiteDatabase } from 'expo-sqlite';
import { attachDictionary } from './dictionary';

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  file_path TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'import',
  added_at INTEGER NOT NULL,
  last_opened_at INTEGER
);
CREATE TABLE IF NOT EXISTS reading_state (
  book_id INTEGER PRIMARY KEY NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  cfi TEXT,
  percent REAL NOT NULL DEFAULT 0,
  font_size INTEGER NOT NULL DEFAULT 100,
  theme TEXT NOT NULL DEFAULT 'light',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vocab (
  id INTEGER PRIMARY KEY NOT NULL,
  lemma TEXT NOT NULL,
  pos TEXT NOT NULL DEFAULT '',
  translations_json TEXT NOT NULL DEFAULT '[]',
  ipa TEXT,
  added_at INTEGER NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1,
  is_leech INTEGER NOT NULL DEFAULT 0,
  UNIQUE(lemma, pos)
);
CREATE TABLE IF NOT EXISTS vocab_contexts (
  id INTEGER PRIMARY KEY NOT NULL,
  vocab_id INTEGER NOT NULL REFERENCES vocab(id) ON DELETE CASCADE,
  form TEXT NOT NULL,
  sentence TEXT NOT NULL,
  translation TEXT,
  book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
  cfi TEXT,
  source TEXT NOT NULL DEFAULT 'book',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vocab_contexts_vocab ON vocab_contexts(vocab_id);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY NOT NULL,
  vocab_id INTEGER NOT NULL REFERENCES vocab(id) ON DELETE CASCADE,
  context_id INTEGER REFERENCES vocab_contexts(id) ON DELETE SET NULL,
  due INTEGER NOT NULL,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0,
  last_review INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(state, due);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_vocab ON cards(vocab_id);
CREATE TABLE IF NOT EXISTS review_log (
  id INTEGER PRIMARY KEY NOT NULL,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  state INTEGER NOT NULL,
  due INTEGER NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  last_elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  learning_steps INTEGER NOT NULL,
  reviewed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_log_time ON review_log(reviewed_at);
CREATE TABLE IF NOT EXISTS examples_cache (
  key TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;

  if (version < 1) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(SCHEMA_V1);
      await tx.execAsync('PRAGMA user_version = 1');
    });
  }

  // Словарь подключается на каждом старте (ATTACH живёт только в рамках соединения).
  const dict = await attachDictionary(db);
  console.log(`[dict] ${dict.source} v${dict.version}, ${dict.entries} статей`);
}
