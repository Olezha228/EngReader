// Личный словарь: список слов с переводами и числом контекстов. Карточки повторения — задача T-3.x.
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Speech from 'expo-speech';
import { useSQLiteContext } from 'expo-sqlite';
import { deleteVocab, exportVocabCsv, listVocab, type VocabItem } from '../lib/vocab';

type Props = { onBack: () => void; onChanged: () => void };

export function VocabScreen({ onBack, onChanged }: Props) {
  const db = useSQLiteContext();
  const [items, setItems] = useState<VocabItem[]>([]);

  const refresh = useCallback(async () => setItems(await listVocab(db)), [db]);
  useEffect(() => { void refresh(); }, [refresh]);

  const onDelete = (item: VocabItem) => {
    Alert.alert('Удалить слово?', item.lemma, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteVocab(db, item.id).then(refresh).then(onChanged) },
    ]);
  };

  // Экспорт CSV (открывается в Anki, Numbers, Excel) — страховка от потери данных: всё хранится только на телефоне.
  const onExport = async () => {
    try {
      const csv = await exportVocabCsv(db);
      const file = new File(Paths.cache, `engreader-vocab-${new Date().toISOString().slice(0, 10)}.csv`);
      if (file.exists) file.delete();
      file.create();
      await file.write(csv);
      if (!(await Sharing.isAvailableAsync())) { Alert.alert('Экспорт', `Файл сохранён: ${file.uri}`); return; }
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Экспорт словаря' });
    } catch (e) {
      Alert.alert('Не удалось экспортировать', String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Библиотека</Text></Pressable>
        <Text style={styles.h1}>Словарь · {items.length}</Text>
        {items.length > 0 ? (
          <Pressable onPress={onExport} hitSlop={8} style={styles.exportBtn}><Text style={styles.exportText}>Экспорт</Text></Pressable>
        ) : null}
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>Пусто. Тапните слово в книге и нажмите «В словарь».</Text>}
        renderItem={({ item }) => {
          const translations = (JSON.parse(item.translations_json) as string[]).slice(0, 3).join('; ');
          return (
            <Pressable style={styles.row} onLongPress={() => onDelete(item)} onPress={() => Speech.speak(item.lemma, { language: 'en-US' })}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lemma}>{item.lemma} {item.ipa ? <Text style={styles.ipa}>/{item.ipa}/</Text> : null}</Text>
                <Text style={styles.ru}>{translations || '— без перевода —'}</Text>
              </View>
              <Text style={styles.meta}>×{item.seen_count}{'\n'}{item.contexts} контекст</Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  back: { color: '#2f6fed', fontSize: 16 },
  h1: { fontSize: 22, fontWeight: '700', flex: 1 },
  exportBtn: { backgroundColor: '#eef1f5', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  exportText: { fontWeight: '600' },
  list: { paddingHorizontal: 16, gap: 8, paddingBottom: 24 },
  empty: { color: '#777', textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  row: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 12, backgroundColor: '#f6f7f9', alignItems: 'center' },
  lemma: { fontSize: 17, fontWeight: '600' },
  ipa: { fontSize: 13, color: '#666', fontWeight: '400' },
  ru: { color: '#333', marginTop: 2 },
  meta: { color: '#888', fontSize: 11, textAlign: 'right' },
});
