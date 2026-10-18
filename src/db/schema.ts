// Схема локальной БД (SQLite на телефоне). Миграции — только вперёд, по PRAGMA user_version.
// Контракт таблиц — на доске проработки, этап 3 («Контракт локального хранения»).
import type { SQLiteDatabase } from 'expo-sqlite';
import { seedDictionary } from './seedDict';

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
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dict_entries (
  id INTEGER PRIMARY KEY NOT NULL,
  lemma TEXT NOT NULL,
  pos TEXT NOT NULL,
  ipa TEXT,
  freq_rank INTEGER
);
CREATE INDEX IF NOT EXISTS idx_dict_entries_lemma ON dict_entries(lemma);
CREATE TABLE IF NOT EXISTS dict_senses (
  entry_id INTEGER NOT NULL REFERENCES dict_entries(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  ru TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dict_senses_entry ON dict_senses(entry_id);
CREATE TABLE IF NOT EXISTS dict_forms (
  form TEXT PRIMARY KEY NOT NULL,
  entry_id INTEGER NOT NULL REFERENCES dict_entries(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS dict_phrasals (
  phrase TEXT PRIMARY KEY NOT NULL,
  entry_id INTEGER NOT NULL REFERENCES dict_entries(id) ON DELETE CASCADE
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
  book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
  cfi TEXT,
  source TEXT NOT NULL DEFAULT 'book',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vocab_contexts_vocab ON vocab_contexts(vocab_id);
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
      await seedDictionary(tx);
      await tx.execAsync('PRAGMA user_version = 1');
    });
  }
}
