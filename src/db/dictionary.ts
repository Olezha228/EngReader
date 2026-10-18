// Подключение офлайн-словаря (assets/dict/dict.db, собран scripts/build-dict.py).
// Файл копируется из бандла в документы приложения и подключается ATTACH к основной БД:
// таблицы dict_* в запросах остаются без префикса — SQLite ищет их в присоединённой базе,
// если в основной их нет. Если ассета/подключения нет — фолбэк на посевной словарь в основной БД.
import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { seedDictionary } from './seedDict';

/** Версия словаря в бандле; при смене — файл в документах перезаписывается. Совпадает с dict_meta.version. */
export const BUNDLED_DICT_VERSION = '20261018';

const DICT_FILE = 'dict.db';

const SEED_SCHEMA = `
CREATE TABLE IF NOT EXISTS dict_entries (id INTEGER PRIMARY KEY NOT NULL, lemma TEXT NOT NULL, pos TEXT NOT NULL, ipa TEXT, freq_rank INTEGER);
CREATE INDEX IF NOT EXISTS idx_dict_entries_lemma ON dict_entries(lemma);
CREATE TABLE IF NOT EXISTS dict_senses (entry_id INTEGER NOT NULL, ord INTEGER NOT NULL, ru TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_dict_senses_entry ON dict_senses(entry_id);
CREATE TABLE IF NOT EXISTS dict_forms (form TEXT PRIMARY KEY NOT NULL, entry_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS dict_phrasals (phrase TEXT PRIMARY KEY NOT NULL, entry_id INTEGER NOT NULL);
`;

export type DictionaryInfo = { source: 'bundled' | 'seed'; version: string; entries: number };

function filePathFromUri(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

async function copyBundledDict(): Promise<File | null> {
  const dest = new File(Paths.document, DICT_FILE);
  const versionFile = new File(Paths.document, `${DICT_FILE}.version`);
  const current = versionFile.exists ? versionFile.textSync().trim() : '';
  if (dest.exists && current === BUNDLED_DICT_VERSION) return dest;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const [asset] = await Asset.loadAsync(require('../../assets/dict/dict.db'));
  if (!asset.localUri) return null;
  if (dest.exists) dest.delete();
  await new File(asset.localUri).copy(dest);
  if (versionFile.exists) versionFile.delete();
  versionFile.create();
  await versionFile.write(BUNDLED_DICT_VERSION);
  return dest;
}

/** Вызывать из onInit после миграций основной БД. */
export async function attachDictionary(db: SQLiteDatabase): Promise<DictionaryInfo> {
  try {
    const file = await copyBundledDict();
    if (!file) throw new Error('bundled dict asset has no localUri');
    const path = filePathFromUri(file.uri).replace(/'/g, "''");
    await db.execAsync(`ATTACH DATABASE '${path}' AS dict`);
    const meta = await db.getFirstAsync<{ value: string }>("SELECT value FROM dict.dict_meta WHERE key = 'version'");
    const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM dict.dict_entries');
    return { source: 'bundled', version: meta?.value ?? 'unknown', entries: count?.n ?? 0 };
  } catch (e) {
    console.warn('[dict] bundled dictionary unavailable, falling back to seed:', e);
    await db.execAsync(SEED_SCHEMA);
    await seedDictionary(db);
    const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM dict_entries');
    return { source: 'seed', version: 'seed', entries: count?.n ?? 0 };
  }
}
