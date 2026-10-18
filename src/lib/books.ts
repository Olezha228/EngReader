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

export type ReadingState = { cfi: string | null; percent: number; font_size: number };

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
  if (!/\.epub$/i.test(asset.name)) throw new Error('Это не EPUB: выберите файл с расширением .epub');
  return importBookFromUri(db, asset.uri, asset.name);
}

export async function importBookFromUri(db: SQLiteDatabase, uri: string, name: string): Promise<number> {
  const src = new File(uri);
  const dest = new File(booksDir(), `${Date.now()}-${safeName(name)}`);
  await src.copy(dest);
  const title = name.replace(/\.epub$/i, '').replace(/[_-]+/g, ' ');
  return insertBook(db, title, dest.uri, 'import');
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
    'SELECT cfi, percent, font_size FROM reading_state WHERE book_id = ?', bookId,
  );
  return row ?? { cfi: null, percent: 0, font_size: 100 };
}

export async function saveReadingState(
  db: SQLiteDatabase, bookId: number, state: Partial<ReadingState>,
): Promise<void> {
  const current = await getReadingState(db, bookId);
  const next = { ...current, ...state };
  await db.runAsync(
    `INSERT INTO reading_state (book_id, cfi, percent, font_size, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(book_id) DO UPDATE SET cfi = excluded.cfi, percent = excluded.percent,
       font_size = excluded.font_size, updated_at = excluded.updated_at`,
    bookId, next.cfi, next.percent, next.font_size, Date.now(),
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
