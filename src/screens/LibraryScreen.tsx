// Библиотека: список книг, импорт EPUB, переход в словарь.
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { deleteBook, ensureSampleBook, listBooks, pickAndImportBook, type Book } from '../lib/books';

type Props = { onOpen: (book: Book) => void; onVocab: () => void; onCards: () => void; vocabCount: number };

export function LibraryScreen({ onOpen, onVocab, onCards, vocabCount }: Props) {
  const db = useSQLiteContext();
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => setBooks(await listBooks(db)), [db]);

  useEffect(() => {
    ensureSampleBook(db).catch((e) => console.warn('sample book', e)).finally(() => void refresh());
  }, [db, refresh]);

  const onAdd = async () => {
    setBusy(true);
    try {
      const id = await pickAndImportBook(db);
      if (id !== null) await refresh();
    } catch (e) {
      Alert.alert('Не удалось добавить книгу', String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = (book: Book) => {
    Alert.alert('Удалить книгу?', book.title, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteBook(db, book).then(refresh) },
    ]);
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.h1}>Библиотека</Text>
        <View style={styles.headerBtns}>
          <Pressable onPress={onCards} style={styles.vocabBtn}>
            <Text style={styles.vocabBtnText}>Карточки</Text>
          </Pressable>
          <Pressable onPress={onVocab} style={styles.vocabBtn}>
            <Text style={styles.vocabBtnText}>Словарь · {vocabCount}</Text>
          </Pressable>
        </View>
      </View>
      <FlatList
        data={books}
        keyExtractor={(b) => String(b.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>Книг пока нет — добавьте EPUB</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => onOpen(item)} onLongPress={() => onDelete(item)}>
            <View style={styles.cover}><Text style={styles.coverText}>{item.title.slice(0, 1).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
              {item.author ? <Text style={styles.author}>{item.author}</Text> : null}
              <Text style={styles.meta}>{Math.round(item.percent * 100)} %{item.source === 'sample' ? ' · тестовая книга' : ''}</Text>
            </View>
          </Pressable>
        )}
      />
      <Pressable style={[styles.addBtn, busy && styles.addBtnDisabled]} onPress={onAdd} disabled={busy}>
        <Text style={styles.addBtnText}>{busy ? 'Копируем…' : '+ Добавить EPUB'}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  h1: { fontSize: 28, fontWeight: '700' },
  headerBtns: { flexDirection: 'row', gap: 8 },
  vocabBtn: { backgroundColor: '#eef1f5', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  vocabBtnText: { fontWeight: '600' },
  list: { paddingHorizontal: 16, gap: 10, paddingBottom: 90 },
  empty: { color: '#777', textAlign: 'center', marginTop: 40 },
  card: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 12, backgroundColor: '#f6f7f9' },
  cover: { width: 48, height: 64, borderRadius: 6, backgroundColor: '#2f6fed', alignItems: 'center', justifyContent: 'center' },
  coverText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  title: { fontSize: 16, fontWeight: '600' },
  author: { color: '#555', marginTop: 2 },
  meta: { color: '#888', fontSize: 12, marginTop: 4 },
  addBtn: { position: 'absolute', left: 16, right: 16, bottom: 24, backgroundColor: '#2f6fed', padding: 14, borderRadius: 12, alignItems: 'center' },
  addBtnDisabled: { opacity: 0.6 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
