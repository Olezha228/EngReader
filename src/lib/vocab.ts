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
  is_leech: number;
  note: string | null;
  contexts: number;
};

/** Своя подсказка или пример — показывается на лицевой стороне карточки (прежде всего для «сложных»). */
export async function setVocabNote(db: SQLiteDatabase, id: number, note: string): Promise<void> {
  await db.runAsync('UPDATE vocab SET note = ? WHERE id = ?', note.trim() || null, id);
}

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

const SUFFIX_VARIANTS = (w: string): string[] => {
  const out = [w, `${w}s`, `${w}es`, `${w}ed`, `${w}d`, `${w}ing`];
  if (w.endsWith('e')) out.push(`${w.slice(0, -1)}ing`);
  if (w.endsWith('y')) out.push(`${w.slice(0, -1)}ies`, `${w.slice(0, -1)}ied`);
  return out;
};

/**
 * Слова и фразы словаря во всех формах — для подсветки в тексте книги (US-2.2).
 * Формы берутся из словарной базы (take → took, taken, takes, taking) плюс регулярные суффиксы;
 * у фразы склоняется первое слово: «take off» → «took off», «taking off». Длинные — первыми.
 */
export async function knownWords(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ lemma: string }>('SELECT lemma FROM vocab');
  const ctxForms = await db.getAllAsync<{ form: string }>('SELECT DISTINCT form FROM vocab_contexts');
  const out = new Set<string>();
  const add = (s: string) => { const v = s.trim().toLowerCase(); if (v.length > 1) out.add(v); };
  for (const { form } of ctxForms) add(form);
  for (const { lemma } of rows) {
    const words = lemma.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const head = words[0];
    const tail = words.slice(1).join(' ');
    let forms: string[] = [];
    try {
      const fr = await db.getAllAsync<{ form: string }>(
        'SELECT f.form FROM dict_forms f JOIN dict_entries e ON e.id = f.entry_id WHERE e.lemma = ?', head,
      );
      forms = fr.map((r) => r.form);
    } catch { /* словарь может быть не подключён */ }
    const heads = new Set<string>([head, ...forms, ...SUFFIX_VARIANTS(head)]);
    for (const h of heads) add(tail ? `${h} ${tail}` : h);
    if (out.size > 3000) break;
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Перевод, заданный пользователем (для фраз и слов, которых нет в словаре). */
export async function setVocabTranslations(db: SQLiteDatabase, id: number, translations: string[]): Promise<void> {
  const clean = translations.map((t) => t.trim()).filter(Boolean);
  await db.runAsync('UPDATE vocab SET translations_json = ? WHERE id = ?', JSON.stringify(clean), id);
}

/**
 * Пример употребления из внешнего источника как дополнительный контекст слова (US-4.4).
 * Если у слова ещё нет перевода (фраза вне словаря), русская часть примера становится его переводом.
 */
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
  const row = await db.getFirstAsync<{ translations_json: string }>('SELECT translations_json FROM vocab WHERE id = ?', args.vocabId);
  const current = row ? (JSON.parse(row.translations_json) as string[]) : [];
  if (current.length === 0 && args.ru) await setVocabTranslations(db, args.vocabId, [args.ru]);
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
