// Книги: импорт файла, тестовая книга из ассетов, чтение в base64, позиция чтения.
import { Asset } from 'expo-asset';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

export type Book = {
  id: number;
  title: string;
  author: string | null;
  file_path: string;
  source: string;
  added_at: number;
  last_opened_at: number | null;
  percent: number;
};

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export const READER_THEMES: ReaderTheme[] = ['light', 'sepia', 'dark'];
export type ReadingState = { cfi: string | null; percent: number; font_size: number; theme: ReaderTheme };

function booksDir(): Directory {
  const dir = new Directory(Paths.document, 'books');
  if (!dir.exists) dir.create();
  return dir;
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'book.epub';
}

export async function listBooks(db: SQLiteDatabase): Promise<Book[]> {
  return db.getAllAsync<Book>(
    `SELECT b.*, COALESCE(r.percent, 0) AS percent
       FROM books b LEFT JOIN reading_state r ON r.book_id = b.id
      ORDER BY COALESCE(b.last_opened_at, b.added_at) DESC`,
  );
}

async function insertBook(db: SQLiteDatabase, title: string, filePath: string, source: string): Promise<number> {
  const res = await db.runAsync(
    'INSERT INTO books (title, author, file_path, source, added_at) VALUES (?, NULL, ?, ?, ?)',
    title, filePath, source, Date.now(),
  );
  return res.lastInsertRowId;
}

/** Открывает системный выбор файла и копирует EPUB в документы приложения. */
export async function pickAndImportBook(db: SQLiteDatabase): Promise<number | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/epub+zip', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  // iOS может отдать имя без расширения и без mimeType — проверяем содержимое: EPUB это zip (сигнатура PK\x03\x04).
  console.log('[books] picked', { name: asset.name, mimeType: asset.mimeType, size: asset.size, uri: asset.uri });
  const looksEpub = /\.epub$/i.test(asset.name) || /\.epub$/i.test(asset.uri) || asset.mimeType === 'application/epub+zip';
  if (!looksEpub) {
    const probe = await probeZip(asset.uri);
    console.log('[books] probe', probe);
    if (probe.kind === 'unreadable') {
      throw new Error(`Не удалось прочитать «${asset.name}»: ${probe.error}. Если файл в iCloud — сначала скачайте его в «Файлах» (значок облака), затем выберите снова.`);
    }
    if (probe.kind === 'not-zip') {
      const format = probe.head.startsWith('%PDF') ? 'PDF'
        : /^<\?xml|<FictionBook/.test(probe.head) ? 'FB2'
          : asset.mimeType || 'неизвестный формат';
      throw new Error(
        `«${asset.name}» — это ${format}, а не EPUB. Приложение читает только EPUB без DRM. ` +
        `Найдите эту книгу в формате .epub или конвертируйте файл в Calibre (бесплатно, на компьютере).`,
      );
    }
  }
  const name = /\.epub$/i.test(asset.name) ? asset.name : `${asset.name.replace(/\.[^.]+$/, '') || 'book'}.epub`;
  return importBookFromUri(db, asset.uri, name);
}

type ZipProbe = { kind: 'zip' } | { kind: 'not-zip'; head: string } | { kind: 'unreadable'; error: string };

/** Первые байты файла: zip начинается с «PK\x03\x04», в base64 это «UEsDBA». */
async function probeZip(uri: string): Promise<ZipProbe> {
  try {
    const b64 = await new File(uri).base64();
    if (b64.startsWith('UEsDBA')) return { kind: 'zip' };
    let head = b64.slice(0, 12);
    try { head = atob(b64.slice(0, 16)).replace(/[^\x20-\x7e]/g, '·'); } catch { /* оставим base64 */ }
    return { kind: 'not-zip', head: `${head} (${b64.length ? Math.round((b64.length * 3) / 4) : 0} байт)` };
  } catch (e) {
    return { kind: 'unreadable', error: String(e instanceof Error ? e.message : e) };
  }
}

export async function importBookFromUri(
  db: SQLiteDatabase, uri: string, name: string, opts: { move?: boolean } = {},
): Promise<number> {
  const src = new File(uri);
  if (!src.exists) throw new Error(`Файл не найден: ${name}`);
  const dest = new File(booksDir(), `${Date.now()}-${safeName(name)}`);
  await src.copy(dest);
  if (opts.move) { try { src.delete(); } catch { /* Inbox может быть уже очищен системой */ } }
  const title = name.replace(/\.epub$/i, '').replace(/[_-]+/g, ' ');
  return insertBook(db, title, dest.uri, 'import');
}

export function isEpubUri(uri: string): boolean {
  return /^file:/i.test(uri) && /\.epub(\?.*)?$/i.test(uri);
}

export function fileNameFromUri(uri: string): string {
  const last = uri.split('?')[0].split('/').pop() ?? 'book.epub';
  try { return decodeURIComponent(last); } catch { return last; }
}

/**
 * Книги, попавшие в Documents напрямую: через «Открыть в EngReader» (iOS кладёт в Documents/Inbox)
 * или перетаскиванием в папку приложения в «Файлах» (UIFileSharingEnabled). Переносим в books/ и регистрируем.
 */
export async function importLooseFiles(db: SQLiteDatabase): Promise<number> {
  let imported = 0;
  const roots = [Paths.document, new Directory(Paths.document, 'Inbox')];
  for (const dir of roots) {
    if (!dir.exists) continue;
    let entries: (File | Directory)[] = [];
    try { entries = dir.list(); } catch { continue; }
    for (const entry of entries) {
      if (!(entry instanceof File) || !/\.epub$/i.test(entry.name)) continue;
      try {
        await importBookFromUri(db, entry.uri, entry.name, { move: true });
        imported += 1;
      } catch (e) {
        console.warn('[books] loose import failed', entry.name, e);
      }
    }
  }
  return imported;
}

export async function getBook(db: SQLiteDatabase, id: number): Promise<Book | null> {
  return db.getFirstAsync<Book>(
    `SELECT b.*, COALESCE(r.percent, 0) AS percent FROM books b LEFT JOIN reading_state r ON r.book_id = b.id WHERE b.id = ?`,
    id,
  );
}

/** Тестовая книга (Project Gutenberg, public domain) — кладётся один раз при первом запуске. */
export async function ensureSampleBook(db: SQLiteDatabase): Promise<void> {
  const exists = await db.getFirstAsync<{ id: number }>("SELECT id FROM books WHERE source = 'sample'");
  if (exists) return;
  const [asset] = await Asset.loadAsync(require('../../assets/books/alice.epub'));
  if (!asset.localUri) throw new Error('Не удалось загрузить тестовую книгу из ассетов');
  const dest = new File(booksDir(), 'alice.epub');
  if (!dest.exists) await new File(asset.localUri).copy(dest);
  await insertBook(db, "Alice's Adventures in Wonderland", dest.uri, 'sample');
}

export async function readBookBase64(filePath: string): Promise<string> {
  return new File(filePath).base64();
}

export async function getReadingState(db: SQLiteDatabase, bookId: number): Promise<ReadingState> {
  const row = await db.getFirstAsync<ReadingState>(
    'SELECT cfi, percent, font_size, theme FROM reading_state WHERE book_id = ?', bookId,
  );
  return row ?? { cfi: null, percent: 0, font_size: 100, theme: 'light' };
}

export async function saveReadingState(
  db: SQLiteDatabase, bookId: number, state: Partial<ReadingState>,
): Promise<void> {
  const current = await getReadingState(db, bookId);
  const next = { ...current, ...state };
  await db.runAsync(
    `INSERT INTO reading_state (book_id, cfi, percent, font_size, theme, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET cfi = excluded.cfi, percent = excluded.percent,
       font_size = excluded.font_size, theme = excluded.theme, updated_at = excluded.updated_at`,
    bookId, next.cfi, next.percent, next.font_size, next.theme, Date.now(),
  );
  await db.runAsync('UPDATE books SET last_opened_at = ? WHERE id = ?', Date.now(), bookId);
}

export async function updateBookMeta(db: SQLiteDatabase, bookId: number, title: string, author: string): Promise<void> {
  if (!title) return;
  await db.runAsync('UPDATE books SET title = ?, author = COALESCE(NULLIF(?, \'\'), author) WHERE id = ?', title, author, bookId);
}

export async function deleteBook(db: SQLiteDatabase, book: Book): Promise<void> {
  await db.runAsync('DELETE FROM books WHERE id = ?', book.id);
  const f = new File(book.file_path);
  if (f.exists) f.delete();
}
