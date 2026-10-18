// Интервальное повторение: FSRS (ts-fsrs) поверх таблиц cards / review_log. ADR-005.
// Карточка = слово в контексте книги (пропуск в предложении), одна карточка на слово словаря.
import type { SQLiteDatabase } from 'expo-sqlite';
import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from 'ts-fsrs';

export { Rating, State };
export type { Grade };

export const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 365,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
});

export const NEW_PER_DAY_DEFAULT = 20;
export const LEECH_LAPSES = 3;

export type CardRow = {
  id: number;
  vocab_id: number;
  context_id: number | null;
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
};

export type QueueItem = CardRow & {
  lemma: string;
  pos: string;
  ipa: string | null;
  translations_json: string;
  is_leech: number;
  form: string | null;
  sentence: string | null;
};

export type Queue = { items: QueueItem[]; dueCount: number; newCount: number; newLimit: number };

export function rowToCard(row: CardRow): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

/** Начало сегодняшнего дня по локальному времени (день повторений начинается в 4:00, как в Anki). */
export function startOfStudyDay(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(4, 0, 0, 0);
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
  return d;
}

/** Человекочитаемый интервал до даты: «1 мин», «10 мин», «1 д», «4 д», «2 мес». */
export function formatInterval(from: Date, to: Date): string {
  const ms = Math.max(0, to.getTime() - from.getTime());
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} мин`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} д`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} мес`;
  return `${Math.round(days / 365)} г`;
}

/** Предложение с пропуском на месте словоформы (или леммы), регистр не важен. */
export function blankOut(sentence: string, form: string, lemma?: string): { text: string; blanked: boolean } {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const target of [form, lemma].filter((s): s is string => !!s && s.length > 0)) {
    const re = new RegExp(`\\b${esc(target)}\\b`, 'gi');
    if (re.test(sentence)) return { text: sentence.replace(re, '_____'), blanked: true };
  }
  return { text: sentence, blanked: false };
}

export function previewIntervals(row: CardRow, now: Date = new Date()): Record<Grade, string> {
  const preview = scheduler.repeat(rowToCard(row), now);
  return {
    [Rating.Again]: formatInterval(now, preview[Rating.Again].card.due),
    [Rating.Hard]: formatInterval(now, preview[Rating.Hard].card.due),
    [Rating.Good]: formatInterval(now, preview[Rating.Good].card.due),
    [Rating.Easy]: formatInterval(now, preview[Rating.Easy].card.due),
  };
}

export async function getNewPerDay(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'new_per_day'");
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : NEW_PER_DAY_DEFAULT;
}

/** Создаёт карточку для слова словаря, если её ещё нет. */
export async function ensureCard(db: SQLiteDatabase, vocabId: number, contextId: number | null, now: Date = new Date()): Promise<void> {
  const card = createEmptyCard(now);
  await db.runAsync(
    `INSERT OR IGNORE INTO cards (vocab_id, context_id, due, stability, difficulty, elapsed_days, scheduled_days,
       learning_steps, reps, lapses, state, last_review, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    vocabId, contextId, card.due.getTime(), card.stability, card.difficulty, card.elapsed_days,
    card.scheduled_days, card.learning_steps, card.reps, card.lapses, card.state, now.getTime(),
  );
}

const QUEUE_SELECT = `
  SELECT c.*, v.lemma, v.pos, v.ipa, v.translations_json, v.is_leech,
         COALESCE(ctx.form, fc.form) AS form, COALESCE(ctx.sentence, fc.sentence) AS sentence
    FROM cards c
    JOIN vocab v ON v.id = c.vocab_id
    LEFT JOIN vocab_contexts ctx ON ctx.id = c.context_id
    LEFT JOIN vocab_contexts fc ON fc.id = (SELECT id FROM vocab_contexts WHERE vocab_id = v.id ORDER BY created_at LIMIT 1)
`;

/** Очередь дня: просроченные и наступившие повторения первыми, затем новые в пределах дневного лимита. */
export async function getQueue(db: SQLiteDatabase, now: Date = new Date()): Promise<Queue> {
  const nowMs = now.getTime();
  const due = await db.getAllAsync<QueueItem>(
    `${QUEUE_SELECT} WHERE c.state != ? AND c.due <= ? ORDER BY c.due ASC`, State.New, nowMs,
  );
  const newLimit = await getNewPerDay(db);
  const introducedToday = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(DISTINCT card_id) AS n FROM review_log WHERE state = ? AND reviewed_at >= ?',
    State.New, startOfStudyDay(now).getTime(),
  );
  const remainingNew = Math.max(0, newLimit - (introducedToday?.n ?? 0));
  const fresh = remainingNew > 0
    ? await db.getAllAsync<QueueItem>(`${QUEUE_SELECT} WHERE c.state = ? ORDER BY c.created_at ASC LIMIT ?`, State.New, remainingNew)
    : [];
  return { items: [...due, ...fresh], dueCount: due.length, newCount: fresh.length, newLimit };
}

export type RateResult = { next: CardRow; becameLeech: boolean };

/** Применяет оценку: обновляет карточку, пишет журнал, помечает «сложную» после LEECH_LAPSES сбросов. */
export async function rateCard(db: SQLiteDatabase, row: CardRow, grade: Grade, now: Date = new Date()): Promise<RateResult> {
  const { card, log } = scheduler.next(rowToCard(row), now, grade);
  const next: CardRow = {
    ...row,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.getTime() : now.getTime(),
  };
  let becameLeech = false;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE cards SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
         learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review = ? WHERE id = ?`,
      next.due, next.stability, next.difficulty, next.elapsed_days, next.scheduled_days,
      next.learning_steps, next.reps, next.lapses, next.state, next.last_review, row.id,
    );
    await db.runAsync(
      `INSERT INTO review_log (card_id, rating, state, due, stability, difficulty, elapsed_days, last_elapsed_days,
         scheduled_days, learning_steps, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, log.rating, log.state, log.due.getTime(), log.stability, log.difficulty, log.elapsed_days,
      log.last_elapsed_days, log.scheduled_days, log.learning_steps, log.review.getTime(),
    );
    if (grade === Rating.Again && next.lapses >= LEECH_LAPSES && row.lapses < LEECH_LAPSES) {
      await db.runAsync('UPDATE vocab SET is_leech = 1 WHERE id = ?', row.vocab_id);
      becameLeech = true;
    }
  });
  return { next, becameLeech };
}

export type Stats = { total: number; dueNow: number; newTotal: number; reviewedToday: number; leeches: number };

export async function getStats(db: SQLiteDatabase, now: Date = new Date()): Promise<Stats> {
  const total = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM cards'))?.n ?? 0;
  const dueNow = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM cards WHERE state != ? AND due <= ?', State.New, now.getTime()))?.n ?? 0;
  const newTotal = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM cards WHERE state = ?', State.New))?.n ?? 0;
  const reviewedToday = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM review_log WHERE reviewed_at >= ?', startOfStudyDay(now).getTime()))?.n ?? 0;
  const leeches = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM vocab WHERE is_leech = 1'))?.n ?? 0;
  return { total, dueNow, newTotal, reviewedToday, leeches };
}
