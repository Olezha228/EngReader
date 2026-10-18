// Карточка слова снизу экрана: лемма, транскрипция, переводы, контекст, «В словарь», «Примеры», озвучка.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import * as WebBrowser from 'expo-web-browser';
import { useSQLiteContext } from 'expo-sqlite';
import { getExamples, reversoUrl, type Example } from '../lib/examples';
import { addToVocab, getVocabStatus, type VocabStatus } from '../lib/vocab';
import type { Resolved } from '../lib/wordResolver';

export type TappedWord = Resolved & { sentence: string; cfi: string; bookId: number | null };

type Props = { word: TappedWord | null; onClose: () => void };

export function WordSheet({ word, onClose }: Props) {
  const db = useSQLiteContext();
  const [status, setStatus] = useState<VocabStatus>(null);
  const [examples, setExamples] = useState<Example[] | null>(null);
  const [examplesNote, setExamplesNote] = useState<string | null>(null);
  const [loadingExamples, setLoadingExamples] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const entry = word?.entries[0] ?? null;
  const lemma = entry?.lemma ?? word?.headword ?? '';
  const pos = entry?.pos ?? '';

  useEffect(() => {
    setExamples(null);
    setExamplesNote(null);
    setSaved(null);
    if (!word) return;
    getVocabStatus(db, lemma, pos).then(setStatus).catch(() => setStatus(null));
  }, [db, word, lemma, pos]);

  if (!word) return null;

  const speak = (text: string) => Speech.speak(text, { language: 'en-US', rate: 0.95 });

  const onAdd = async () => {
    const res = await addToVocab(db, {
      headword: lemma, entry, form: word.form, sentence: word.sentence, bookId: word.bookId, cfi: word.cfi,
    });
    setStatus({ id: res.id, seen_count: res.seenCount });
    setSaved(res.isNew ? 'Добавлено в словарь' : `Уже в словаре · встречено ${res.seenCount} раз`);
  };

  const onExamples = async () => {
    setLoadingExamples(true);
    const res = await getExamples(db, word.headword);
    setExamples(res.examples);
    if (res.error && res.examples.length === 0) setExamplesNote('Нужна сеть: примеры не загрузились');
    else if (res.fromCache) setExamplesNote('Из кеша');
    setLoadingExamples(false);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.headRow}>
            <Text style={styles.lemma}>{lemma}</Text>
            {entry?.ipa ? <Text style={styles.ipa}>/{entry.ipa}/</Text> : null}
            {pos ? <Text style={styles.pos}>{pos}</Text> : null}
            <Pressable onPress={() => speak(lemma)} style={styles.iconBtn} accessibilityLabel="Озвучить слово">
              <Text style={styles.icon}>🔊</Text>
            </Pressable>
          </View>
          {word.normalized !== lemma ? <Text style={styles.form}>словоформа: {word.normalized}</Text> : null}

          {word.entries.length === 0 ? (
            <Text style={styles.missing}>
              {word.maybeProperNoun ? 'Похоже на имя собственное' : 'Нет в словаре'} — можно сохранить без перевода и посмотреть примеры
            </Text>
          ) : (
            word.entries.map((e) => (
              <View key={e.id} style={styles.entry}>
                {word.entries.length > 1 ? (
                  <Text style={styles.entryHead}>{e.lemma} <Text style={styles.pos}>{e.pos}</Text></Text>
                ) : null}
                {e.senses.map((s, i) => (
                  <Text key={i} style={styles.sense}>{i + 1}. {s}</Text>
                ))}
              </View>
            ))
          )}

          <Pressable onPress={() => speak(word.sentence)} accessibilityLabel="Озвучить предложение">
            <Text style={styles.context}>« {word.sentence} »</Text>
          </Pressable>

          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onAdd}>
              <Text style={styles.btnPrimaryText}>
                {status ? `В словаре · ${status.seen_count}` : 'В словарь'}
              </Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={onExamples} disabled={loadingExamples}>
              <Text style={styles.btnText}>Примеры</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={() => WebBrowser.openBrowserAsync(reversoUrl(word.headword))}>
              <Text style={styles.btnText}>Reverso ↗</Text>
            </Pressable>
          </View>
          {saved ? <Text style={styles.note}>{saved}</Text> : null}

          {loadingExamples ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
          {examples ? (
            <View style={styles.examples}>
              {examplesNote ? <Text style={styles.note}>{examplesNote}</Text> : null}
              {examples.length === 0 && !examplesNote ? <Text style={styles.note}>Примеров не нашлось</Text> : null}
              {examples.map((ex, i) => (
                <View key={i} style={styles.example}>
                  <Text style={styles.exEn}>{ex.en}</Text>
                  <Text style={styles.exRu}>{ex.ru}</Text>
                  <Text style={styles.exSrc}>{ex.source}{ex.license ? ` · ${ex.license}` : ''}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '70%', paddingBottom: 24,
  },
  content: { padding: 16, gap: 8 },
  headRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  lemma: { fontSize: 26, fontWeight: '700' },
  ipa: { fontSize: 16, color: '#555' },
  pos: { fontSize: 13, color: '#8a6d3b', fontStyle: 'italic' },
  form: { color: '#666', fontSize: 13 },
  iconBtn: { marginLeft: 'auto', padding: 4 },
  icon: { fontSize: 20 },
  entry: { gap: 2 },
  entryHead: { fontWeight: '600', marginTop: 4 },
  sense: { fontSize: 17 },
  missing: { color: '#a33', fontSize: 15 },
  context: { color: '#333', fontStyle: 'italic', marginTop: 6, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  btn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#eef1f5' },
  btnText: { fontWeight: '600', color: '#223' },
  btnPrimary: { backgroundColor: '#2f6fed' },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  note: { color: '#666', fontSize: 13, marginTop: 6 },
  examples: { marginTop: 8, gap: 10 },
  example: { gap: 2, borderLeftWidth: 2, borderLeftColor: '#dde3ea', paddingLeft: 8 },
  exEn: { fontSize: 15 },
  exRu: { fontSize: 15, color: '#444' },
  exSrc: { fontSize: 11, color: '#888' },
});
