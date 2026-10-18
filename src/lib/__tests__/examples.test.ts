// Парсер Tatoeba на живом снимке ответа (docs/io-samples, снят 18.10.2026) и деградация при ошибках.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reversoUrl, tatoeba } from '../examples';

const snapshot = JSON.parse(readFileSync(join(__dirname, '../../../docs/io-samples/tatoeba_give_up.json'), 'utf8'));

function mockFetch(status: number, body: unknown) {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('tatoeba provider', () => {
  test('разбирает живой ответ: не больше 5 примеров, прямой перевод, атрибуция и лицензия', async () => {
    mockFetch(200, snapshot);
    const examples = await tatoeba.fetch('give up');
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.length).toBeLessThanOrEqual(5);
    expect(examples[0]).toMatchObject({ en: 'Give up.', ru: 'Сдавайся.', license: 'CC BY 2.0 FR' });
    expect(examples[0].source).toMatch(/^Tatoeba · @/);
    expect(examples[0].url).toMatch(/tatoeba\.org\/en\/sentences\/show\/\d+/);
  });

  test('запрос — точное совпадение словоформы', async () => {
    mockFetch(200, { results: [] });
    await tatoeba.fetch('give up');
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain('query=%3Dgive%20up');
    expect(url).toContain('from=eng&to=rus');
  });

  test('429 — ошибка, а не пустой успех', async () => {
    mockFetch(429, {});
    await expect(tatoeba.fetch('run')).rejects.toThrow('tatoeba 429');
  });
});

test('reversoUrl — страница перевода с плюсами вместо пробелов', () => {
  expect(reversoUrl('give up')).toBe('https://context.reverso.net/translation/english-russian/give+up');
});
