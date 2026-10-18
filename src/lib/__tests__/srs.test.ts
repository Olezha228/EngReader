// Планировщик FSRS: лестница сроков по таблице этапа 2, пропуск в контексте, форматирование интервалов.
import { createEmptyCard } from 'ts-fsrs';
import { blankOut, formatInterval, previewIntervals, Rating, rowToCard, scheduler, startOfStudyDay, State, type CardRow } from '../srs';

const now = new Date('2026-10-18T12:00:00Z');

function freshRow(): CardRow {
  const c = createEmptyCard(now);
  return {
    id: 1, vocab_id: 1, context_id: 1,
    due: c.due.getTime(), stability: c.stability, difficulty: c.difficulty,
    elapsed_days: c.elapsed_days, scheduled_days: c.scheduled_days, learning_steps: c.learning_steps,
    reps: c.reps, lapses: c.lapses, state: c.state, last_review: null,
  };
}

describe('previewIntervals для новой карточки', () => {
  const p = previewIntervals(freshRow(), now);
  test('не помню → минуты (шаг обучения 1 мин)', () => expect(p[Rating.Again]).toBe('1 мин'));
  test('трудно → 10 мин', () => expect(p[Rating.Hard]).toMatch(/^(5|6|7|8|9|10) мин$/));
  test('помню → второй шаг обучения (10 мин), легко → сразу в дни', () => {
    expect(p[Rating.Good]).toBe('10 мин');
    expect(p[Rating.Easy]).toMatch(/д$/);
  });
  test('второе «помню» через 10 мин выпускает карточку в повторение на ≥ 1 день', () => {
    const first = scheduler.next(rowToCard(freshRow()), now, Rating.Good).card;
    const second = scheduler.next(first, new Date(now.getTime() + 10 * 60_000), Rating.Good).card;
    expect(second.state).toBe(State.Review);
    expect(second.scheduled_days).toBeGreaterThanOrEqual(1);
  });
});

describe('жизненный цикл', () => {
  test('помню на новой → review; три «не помню» подряд в review → lapses ≥ 3', () => {
    let card = rowToCard(freshRow());
    card = scheduler.next(card, now, Rating.Easy).card;
    expect(card.state).toBe(State.Review);
    let t = new Date(card.due.getTime() + 60_000);
    for (let i = 0; i < 3; i++) {
      card = scheduler.next(card, t, Rating.Again).card; // → relearning
      card = scheduler.next(card, new Date(t.getTime() + 11 * 60_000), Rating.Good).card; // обратно в review
      t = new Date(card.due.getTime() + 60_000);
    }
    expect(card.lapses).toBeGreaterThanOrEqual(3);
  });

  test('интервал растёт при последовательных «помню»', () => {
    let card = rowToCard(freshRow());
    const intervals: number[] = [];
    let t = now;
    card = scheduler.next(card, t, Rating.Good).card; // learning 10m
    card = scheduler.next(card, new Date(t.getTime() + 10 * 60_000), Rating.Good).card; // → review
    for (let i = 0; i < 4; i++) {
      t = card.due;
      card = scheduler.next(card, t, Rating.Good).card;
      intervals.push(card.scheduled_days);
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThanOrEqual(intervals[i - 1]);
    expect(intervals[intervals.length - 1]).toBeGreaterThan(7);
  });
});

describe('blankOut', () => {
  test('пропуск на месте словоформы без учёта регистра', () => {
    expect(blankOut('She was Running late.', 'running', 'run')).toEqual({ text: 'She was _____ late.', blanked: true });
  });
  test('если формы нет — пробует лемму', () => {
    expect(blankOut('They run fast.', 'ran', 'run').text).toBe('They _____ fast.');
  });
  test('не ловит слово внутри другого', () => {
    expect(blankOut('A runner ran.', 'run').blanked).toBe(false);
  });
  test('фраза с пробелом', () => {
    expect(blankOut('He decided to give up smoking.', 'give up').text).toBe('He decided to _____ smoking.');
  });
});

describe('formatInterval', () => {
  const from = now;
  const plus = (ms: number) => new Date(from.getTime() + ms);
  test.each([
    [60_000, '1 мин'], [10 * 60_000, '10 мин'], [3 * 3600_000, '3 ч'], [86400_000, '1 д'],
    [4 * 86400_000, '4 д'], [45 * 86400_000, '2 мес'], [400 * 86400_000, '1 г'],
  ])('%i мс → %s', (ms, expected) => expect(formatInterval(from, plus(ms))).toBe(expected));
});

test('startOfStudyDay — день начинается в 4:00', () => {
  const early = new Date(2026, 9, 18, 2, 30);
  expect(startOfStudyDay(early).getDate()).toBe(17);
  expect(startOfStudyDay(early).getHours()).toBe(4);
  const late = new Date(2026, 9, 18, 23, 0);
  expect(startOfStudyDay(late).getDate()).toBe(18);
});
