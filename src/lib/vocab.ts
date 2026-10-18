// Личный словарь: добавление без дублей (lemma+pos), контексты, список.
import type { SQLiteDatabase } from 'expo-sqlite';
import { ensureCard } from './srs';
import type { DictEntry } from './wordResolver';

export type VocabItem = {
  id: number;
  lemma: string;
  pos: string;
  translations_json: string;
  ipa: string | null;
  added_at: number;
  seen_count: number;
  contexts: number;
};

export type VocabStatus = { id: number; seen_count: number } | null;

export async function getVocabStatus(db: SQLiteDatabase, lemma: string, pos: string): Promise<VocabStatus> {
  return db.getFirstAsync<{ id: number; seen_count: number }>(
    'SELECT id, seen_count FROM vocab WHERE lemma = ? AND pos = ?', lemma, pos,
  );
}

/** Добавляет слово; при повторе увеличивает счётчик встреч и дописывает новый контекст. */
export async function addToVocab(
  db: SQLiteDatabase,
  args: { headword: string; entry: DictEntry | null; form: string; sentence: string; bookId: number | null; cfi: string },
): Promise<{ id: number; isNew: boolean; seenCount: number }> {
  const lemma = args.entry?.lemma ?? args.headword;
  const pos = args.entry?.pos ?? '';
  let result = { id: 0, isNew: false, seenCount: 1 };
  await db.withTransactionAsync(async () => {
    const existing = await getVocabStatus(db, lemma, pos);
    let id: number;
    let isNew = false;
    let seenCount = 1;
    if (existing) {
      id = existing.id;
      seenCount = existing.seen_count + 1;
      await db.runAsync('UPDATE vocab SET seen_count = ? WHERE id = ?', seenCount, id);
    } else {
      const res = await db.runAsync(
        'INSERT INTO vocab (lemma, pos, translations_json, ipa, added_at) VALUES (?, ?, ?, ?, ?)',
        lemma, pos, JSON.stringify(args.entry?.senses ?? []), args.entry?.ipa ?? null, Date.now(),
      );
      id = res.lastInsertRowId;
      isNew = true;
    }
    const ctx = await db.runAsync(
      `INSERT INTO vocab_contexts (vocab_id, form, sentence, book_id, cfi, source, created_at)
       VALUES (?, ?, ?, ?, ?, 'book', ?)`,
      id, args.form, args.sentence, args.bookId, args.cfi, Date.now(),
    );
    // Карточка повторения — одна на слово, привязана к первому контексту.
    await ensureCard(db, id, ctx.lastInsertRowId);
    result = { id, isNew, seenCount };
  });
  return result;
}

/** Слова и формы, которые подчёркиваются в тексте книги как известные. */
export async function knownWords(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ w: string }>(
    'SELECT lemma AS w FROM vocab UNION SELECT DISTINCT form AS w FROM vocab_contexts',
  );
  return rows.map((r) => r.w).filter((w) => w.length > 1);
}

/** Пример употребления из внешнего источника как дополнительный контекст слова (US-4.4). */
export async function addExampleContext(
  db: SQLiteDatabase,
  args: { vocabId: number; headword: string; en: string; ru: string; source: string },
): Promise<boolean> {
  const dup = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM vocab_contexts WHERE vocab_id = ? AND sentence = ?', args.vocabId, args.en,
  );
  if (dup) return false;
  await db.runAsync(
    `INSERT INTO vocab_contexts (vocab_id, form, sentence, translation, book_id, cfi, source, created_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
    args.vocabId, args.headword, args.en, args.ru, args.source, Date.now(),
  );
  return true;
}

/** CSV для бэкапа и импорта в Anki: слово, часть речи, транскрипция, переводы, контексты. */
export async function exportVocabCsv(db: SQLiteDatabase): Promise<string> {
  const items = await listVocab(db);
  const ctx = await db.getAllAsync<{ vocab_id: number; sentence: string }>(
    'SELECT vocab_id, sentence FROM vocab_contexts ORDER BY created_at',
  );
  const byVocab = new Map<number, string[]>();
  for (const c of ctx) {
    const list = byVocab.get(c.vocab_id) ?? [];
    list.push(c.sentence);
    byVocab.set(c.vocab_id, list);
  }
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ['word,pos,ipa,translations,contexts,added'];
  for (const it of items) {
    const tr = (JSON.parse(it.translations_json) as string[]).join('; ');
    lines.push([
      q(it.lemma), q(it.pos), q(it.ipa ?? ''), q(tr),
      q((byVocab.get(it.id) ?? []).join(' | ')), q(new Date(it.added_at).toISOString().slice(0, 10)),
    ].join(','));
  }
  return `﻿${lines.join('\n')}\n`;
}

export async function listVocab(db: SQLiteDatabase): Promise<VocabItem[]> {
  return db.getAllAsync<VocabItem>(
    `SELECT v.*, (SELECT COUNT(*) FROM vocab_contexts c WHERE c.vocab_id = v.id) AS contexts
       FROM vocab v ORDER BY v.added_at DESC`,
  );
}

export async function deleteVocab(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM vocab WHERE id = ?', id);
}
