// Личный словарь: добавление без дублей (lemma+pos), контексты, список.
import type { SQLiteDatabase } from 'expo-sqlite';
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
    await db.runAsync(
      `INSERT INTO vocab_contexts (vocab_id, form, sentence, book_id, cfi, source, created_at)
       VALUES (?, ?, ?, ?, ?, 'book', ?)`,
      id, args.form, args.sentence, args.bookId, args.cfi, Date.now(),
    );
    result = { id, isNew, seenCount };
  });
  return result;
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
