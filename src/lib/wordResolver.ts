// Резолвер слова: нормализация → фразовый глагол → таблица форм → правила суффиксов → словарь.
// Крайние случаи — таблица на доске (этап 2). Полный лемматизатор и NER — задача T-2.3.
import type { SQLiteDatabase } from 'expo-sqlite';

export type DictEntry = {
  id: number;
  lemma: string;
  pos: string;
  ipa: string | null;
  senses: string[];
};

export type Resolved = {
  /** Что тапнули, как есть в тексте. */
  form: string;
  /** Нормализованная словоформа (нижний регистр, без пунктуации). */
  normalized: string;
  /** Что ищем первым: фраза, если найден фразовый глагол, иначе лемма. */
  headword: string;
  entries: DictEntry[];
  /** Слово похоже на имя собственное (заглавная не в начале предложения) и не найдено. */
  maybeProperNoun: boolean;
};

const CONTRACTIONS: Record<string, string> = {
  "don't": 'do', "doesn't": 'do', "didn't": 'do', "can't": 'can', "won't": 'will',
  "isn't": 'be', "aren't": 'be', "wasn't": 'be', "weren't": 'be', "i'm": 'be',
  "you're": 'be', "we're": 'be', "they're": 'be', "it's": 'it', "that's": 'that',
  "i've": 'have', "you've": 'have', "we've": 'have', "haven't": 'have', "hasn't": 'have',
  "i'll": 'will', "you'll": 'will', "he'll": 'will', "she'll": 'will', "we'll": 'will',
  "i'd": 'would', "you'd": 'would', "he'd": 'would', "she'd": 'would', "we'd": 'would',
  "couldn't": 'could', "shouldn't": 'should', "wouldn't": 'would', "let's": 'let',
};

export function normalizeWord(raw: string): string {
  let w = raw.replace(/[‘’ʼ]/g, "'").toLowerCase();
  w = w.replace(/^[^a-z]+|[^a-z]+$/g, ''); // пунктуация по краям; апостроф и дефис внутри остаются
  w = w.replace(/'s$/, ''); // John's → john
  return w;
}

/** Кандидаты в леммы по простым правилам; первым идёт сама форма. */
export function lemmaCandidates(form: string): string[] {
  const out: string[] = [form];
  const push = (s: string) => { if (s.length >= 2 && !out.includes(s)) out.push(s); };
  if (CONTRACTIONS[form]) push(CONTRACTIONS[form]);
  if (form.endsWith('ies')) push(form.slice(0, -3) + 'y');
  if (form.endsWith('es')) { push(form.slice(0, -2)); push(form.slice(0, -1)); }
  if (form.endsWith('s') && !form.endsWith('ss')) push(form.slice(0, -1));
  if (form.endsWith('ing')) {
    const stem = form.slice(0, -3);
    push(stem); push(stem + 'e');
    if (/([bcdfgklmnprstvz])\1$/.test(stem)) push(stem.slice(0, -1)); // running → run
  }
  if (form.endsWith('ed')) {
    const stem = form.slice(0, -2);
    push(stem); push(stem + 'e'); push(form.slice(0, -1));
    if (/([bcdfgklmnprstvz])\1$/.test(stem)) push(stem.slice(0, -1)); // stopped → stop
    if (stem.endsWith('i')) push(stem.slice(0, -1) + 'y'); // tried → try
  }
  if (form.endsWith('er')) { push(form.slice(0, -2)); push(form.slice(0, -1)); }
  if (form.endsWith('est')) { push(form.slice(0, -3)); push(form.slice(0, -2)); }
  if (form.endsWith('ily')) push(form.slice(0, -3) + 'y'); // happily → happy
  if (form.endsWith('ly')) push(form.slice(0, -2));
  return out;
}

async function loadEntries(db: SQLiteDatabase, ids: number[]): Promise<DictEntry[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ id: number; lemma: string; pos: string; ipa: string | null }>(
    `SELECT id, lemma, pos, ipa FROM dict_entries WHERE id IN (${placeholders})`, ids,
  );
  const senses = await db.getAllAsync<{ entry_id: number; ru: string }>(
    `SELECT entry_id, ru FROM dict_senses WHERE entry_id IN (${placeholders}) ORDER BY entry_id, ord`, ids,
  );
  const byId = new Map<number, DictEntry>();
  for (const r of rows) byId.set(r.id, { ...r, senses: [] });
  for (const s of senses) byId.get(s.entry_id)?.senses.push(s.ru);
  // Порядок — как в ids (словоформа раньше леммы, фраза раньше слова).
  return ids.map((id) => byId.get(id)).filter((e): e is DictEntry => !!e);
}

async function entryIdsByLemma(db: SQLiteDatabase, lemma: string): Promise<number[]> {
  const rows = await db.getAllAsync<{ id: number }>('SELECT id FROM dict_entries WHERE lemma = ? ORDER BY id', lemma);
  return rows.map((r) => r.id);
}

export async function resolveWord(
  db: SQLiteDatabase,
  raw: string,
  neighbors: { prev?: string; next?: string } = {},
  opts: { sentenceStart?: boolean } = {},
): Promise<Resolved> {
  const normalized = normalizeWord(raw);
  const ids: number[] = [];
  const add = (list: number[]) => { for (const id of list) if (!ids.includes(id)) ids.push(id); };
  let headword = normalized;

  // 1. Фразовый глагол с соседом справа или слева: «give up», «look after».
  const next = neighbors.next ? normalizeWord(neighbors.next) : '';
  const prev = neighbors.prev ? normalizeWord(neighbors.prev) : '';
  for (const phrase of [next && `${normalized} ${next}`, prev && `${prev} ${normalized}`]) {
    if (!phrase) continue;
    const hit = await db.getFirstAsync<{ entry_id: number }>('SELECT entry_id FROM dict_phrasals WHERE phrase = ?', phrase);
    if (hit) { add([hit.entry_id]); headword = phrase; break; }
  }
  // Форма со своим смыслом может быть и леммой через правила — тоже проверим по таблице форм.
  for (const lemma of lemmaCandidates(normalized)) {
    const phraseHits = [next && `${lemma} ${next}`, prev && `${prev} ${lemma}`].filter(Boolean) as string[];
    for (const phrase of phraseHits) {
      const hit = await db.getFirstAsync<{ entry_id: number }>('SELECT entry_id FROM dict_phrasals WHERE phrase = ?', phrase);
      if (hit && !ids.includes(hit.entry_id)) { add([hit.entry_id]); if (headword === normalized) headword = phrase; }
    }
  }

  // 2. Сама словоформа как статья (glasses, news) и таблица неправильных форм (ran → run).
  add(await entryIdsByLemma(db, normalized));
  const formHit = await db.getFirstAsync<{ entry_id: number }>('SELECT entry_id FROM dict_forms WHERE form = ?', normalized);
  if (formHit) add([formHit.entry_id]);

  // 3. Правила суффиксов.
  for (const cand of lemmaCandidates(normalized)) add(await entryIdsByLemma(db, cand));

  const entries = await loadEntries(db, ids);
  if (headword === normalized && entries.length > 0 && entries[0].lemma !== normalized) headword = entries[0].lemma;

  const capitalized = /^[A-Z][a-z]/.test(raw.replace(/^[^A-Za-z]+/, ''));
  const maybeProperNoun = entries.length === 0 && capitalized && !opts.sentenceStart;

  return { form: raw, normalized, headword, entries, maybeProperNoun };
}
