// Тесты чистых функций резолвера — по таблице крайних случаев с доски (этап 2).
import { lemmaCandidates, normalizeWord } from '../wordResolver';

describe('normalizeWord', () => {
  test.each([
    ['Running,', 'running'],
    ['don’t', "don't"],
    ['John’s', 'john'],
    ['“hello”', 'hello'],
    ['well-known', 'well-known'],
    ['(quietly)', 'quietly'],
    ['NASA', 'nasa'],
    ['meeting.', 'meeting'],
    ["'tis", 'tis'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeWord(input)).toBe(expected);
  });
});

describe('lemmaCandidates', () => {
  test.each([
    ['running', 'run'],
    ['stopped', 'stop'],
    ['tried', 'try'],
    ['glasses', 'glass'],
    ['larger', 'large'],
    ['largest', 'large'],
    ['meeting', 'meet'],
    ["don't", 'do'],
    ['happily', 'happy'],
    ['families', 'family'],
    ['boxes', 'box'],
    ['hoping', 'hope'],
  ])('%s содержит кандидата %s', (form, lemma) => {
    expect(lemmaCandidates(form)).toContain(lemma);
  });

  test('сама форма идёт первой', () => {
    expect(lemmaCandidates('glasses')[0]).toBe('glasses');
  });

  test('не плодит дублей и коротких обрезков', () => {
    const c = lemmaCandidates('is');
    expect(new Set(c).size).toBe(c.length);
    expect(c.every((w) => w.length >= 2)).toBe(true);
  });
});

describe('phraseVariants', () => {
  const { phraseVariants } = require('../wordResolver') as typeof import('../wordResolver');
  test('grew up → grow up', () => expect(phraseVariants(['grew', 'up'])).toContain('grow up'));
  test('looked after → look after', () => expect(phraseVariants(['looked', 'after'])).toContain('look after'));
  test('не больше 40 вариантов', () => expect(phraseVariants(['running', 'tried', 'boxes', 'families']).length).toBeLessThanOrEqual(40));
});
