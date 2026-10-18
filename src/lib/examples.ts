// Источник примеров употребления. ADR-004 (пересмотр 18.10.2026): по умолчанию Tatoeba (CC BY 2.0 FR),
// Reverso — только веб-страница в in-app browser (их эндпоинт закрыт Cloudflare-челленджем).
import type { SQLiteDatabase } from 'expo-sqlite';

export type Example = {
  en: string;
  ru: string;
  source: string; // «Tatoeba · @username»
  license?: string;
  url?: string;
};

export interface ExamplesProvider {
  readonly name: string;
  fetch(query: string): Promise<Example[]>;
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EXAMPLES = 5;
const TIMEOUT_MS = 12000; // Tatoeba из России отвечает медленно; идёт параллельно с Reverso, поэтому ждать не жалко

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } finally {
    clearTimeout(timer);
  }
}

type TatoebaTranslation = { text: string; lang: string; isDirect?: boolean };
type TatoebaResult = {
  id: number;
  text: string;
  license?: string;
  user?: { username?: string } | null;
  translations: TatoebaTranslation[][];
};

export const tatoeba: ExamplesProvider = {
  name: 'tatoeba',
  async fetch(query: string): Promise<Example[]> {
    // Одно слово: «=слово» — точная словоформа. Фраза: в кавычках — точная последовательность слов.
    const trimmed = query.trim();
    const q = encodeURIComponent(/\s/.test(trimmed) ? `"${trimmed}"` : `=${trimmed}`);
    const url = `https://tatoeba.org/en/api_v0/search?from=eng&to=rus&query=${q}&sort=relevance`;
    const res = await fetchWithTimeout(url, TIMEOUT_MS);
    if (!res.ok) throw new Error(`tatoeba ${res.status}`);
    const json = (await res.json()) as { results?: TatoebaResult[] };
    console.log('[examples] tatoeba', trimmed, 'results:', json.results?.length ?? 0);
    const out: Example[] = [];
    for (const r of json.results ?? []) {
      const direct = r.translations?.[0]?.find((t) => t.lang === 'rus');
      const indirect = r.translations?.[1]?.find((t) => t.lang === 'rus');
      const ru = direct ?? indirect;
      if (!ru) continue;
      out.push({
        en: r.text,
        ru: ru.text,
        source: `Tatoeba${r.user?.username ? ` · @${r.user.username}` : ''}`,
        license: r.license,
        url: `https://tatoeba.org/en/sentences/show/${r.id}`,
      });
      if (out.length >= MAX_EXAMPLES) break;
    }
    return out;
  },
};

export function reversoUrl(query: string): string {
  return `https://context.reverso.net/translation/english-russian/${encodeURIComponent(query).replace(/%20/g, '+')}`;
}

/** Кеш для источников, которые работают не через fetch (Reverso в скрытом WebView). */
export async function getCachedExamples(db: SQLiteDatabase, provider: string, query: string): Promise<Example[] | null> {
  const key = `${provider}:${query.toLowerCase()}`;
  const cached = await db.getFirstAsync<{ payload_json: string; fetched_at: number }>(
    'SELECT payload_json, fetched_at FROM examples_cache WHERE key = ?', key,
  );
  if (!cached || Date.now() - cached.fetched_at >= CACHE_TTL_MS) return null;
  return JSON.parse(cached.payload_json) as Example[];
}

export async function putCachedExamples(db: SQLiteDatabase, provider: string, query: string, examples: Example[]): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO examples_cache (key, provider, payload_json, fetched_at) VALUES (?, ?, ?, ?)',
    `${provider}:${query.toLowerCase()}`, provider, JSON.stringify(examples), Date.now(),
  );
}

/** Примеры с кешем на 30 дней; при любой ошибке сети возвращает закешированные или пустой список и флаг. */
export async function getExamples(
  db: SQLiteDatabase,
  query: string,
  provider: ExamplesProvider = tatoeba,
): Promise<{ examples: Example[]; fromCache: boolean; error?: string }> {
  const key = `${provider.name}:${query.toLowerCase()}`;
  const cached = await db.getFirstAsync<{ payload_json: string; fetched_at: number }>(
    'SELECT payload_json, fetched_at FROM examples_cache WHERE key = ?', key,
  );
  if (cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) {
    return { examples: JSON.parse(cached.payload_json) as Example[], fromCache: true };
  }
  try {
    const examples = await provider.fetch(query);
    await db.runAsync(
      'INSERT OR REPLACE INTO examples_cache (key, provider, payload_json, fetched_at) VALUES (?, ?, ?, ?)',
      key, provider.name, JSON.stringify(examples), Date.now(),
    );
    return { examples, fromCache: false };
  } catch (e) {
    console.log('[examples] failed', query, String(e));
    if (cached) return { examples: JSON.parse(cached.payload_json) as Example[], fromCache: true, error: String(e) };
    return { examples: [], fromCache: false, error: String(e) };
  }
}
