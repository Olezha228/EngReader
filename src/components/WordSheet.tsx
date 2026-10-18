// Карточка слова снизу экрана. Две вкладки: «Перевод» (словарь, контекст, озвучка) и «Примеры» (Tatoeba).
// Действия: «В словарь», «Свой перевод», Reverso в браузере, закрыть.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import * as WebBrowser from 'expo-web-browser';
import { useSQLiteContext } from 'expo-sqlite';
import { getExamples, reversoUrl, type Example } from '../lib/examples';
import { addExampleContext, addToVocab, getVocabStatus, setVocabTranslations, type VocabStatus } from '../lib/vocab';
import type { Resolved } from '../lib/wordResolver';

export type TappedWord = Resolved & { sentence: string; cfi: string; bookId: number | null };

type Props = { word: TappedWord | null; onClose: () => void; onChanged?: () => void };
type Tab = 'translation' | 'examples';

export function WordSheet({ word, onClose, onChanged }: Props) {
  const db = useSQLiteContext();
  const [tab, setTab] = useState<Tab>('translation');
  const [status, setStatus] = useState<VocabStatus>(null);
  const [examples, setExamples] = useState<Example[] | null>(null);
  const [examplesNote, setExamplesNote] = useState<string | null>(null);
  const [loadingExamples, setLoadingExamples] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Для фразы без словарной статьи заголовок и запись в словарь — сама фраза, а не опорное слово.
  const phraseFallback = !!word?.phraseFallback;
  const entry = phraseFallback ? null : (word?.entries[0] ?? null);
  const lemma = entry?.lemma ?? word?.headword ?? '';
  const pos = entry?.pos ?? '';
  const supportEntry = phraseFallback ? (word?.entries[0] ?? null) : null;
  const noTranslation = phraseFallback || (word?.entries.length ?? 0) === 0;

  useEffect(() => {
    setTab('translation');
    setExamples(null);
    setExamplesNote(null);
    setToast(null);
    setStatus(null);
    if (!word) return;
    getVocabStatus(db, lemma, pos).then(setStatus).catch(() => setStatus(null));
  }, [db, word, lemma, pos]);

  useEffect(() => {
    if (tab !== 'examples' || !word || examples !== null || loadingExamples) return;
    let cancelled = false;
    setLoadingExamples(true);
    getExamples(db, word.headword).then((res) => {
      if (cancelled) return;
      setExamples(res.examples);
      if (res.error && res.examples.length === 0) setExamplesNote(`Не загрузилось: ${res.error.replace(/^Error:\s*/, '')}`);
      else if (res.examples.length === 0) setExamplesNote('В Tatoeba нет примеров с этой фразой. Попробуйте Reverso.');
      else if (res.fromCache) setExamplesNote('Из кеша');
    }).finally(() => { if (!cancelled) setLoadingExamples(false); });
    return () => { cancelled = true; };
  }, [tab, word, examples, loadingExamples, db]);

  if (!word) return null;

  const speak = (text: string) => Speech.speak(text, { language: 'en-US', rate: 0.95 });

  const ensureInVocab = async (): Promise<number> => {
    if (status) return status.id;
    const res = await addToVocab(db, { headword: lemma, entry, form: word.form, sentence: word.sentence, bookId: word.bookId, cfi: word.cfi });
    setStatus({ id: res.id, seen_count: res.seenCount });
    onChanged?.();
    return res.id;
  };

  const onAdd = async () => {
    const was = status;
    const res = await addToVocab(db, { headword: lemma, entry, form: word.form, sentence: word.sentence, bookId: word.bookId, cfi: word.cfi });
    setStatus({ id: res.id, seen_count: res.seenCount });
    setToast(was ? `Уже в словаре · встречено ${res.seenCount} раз, контекст добавлен` : 'Добавлено в словарь');
    onChanged?.();
  };

  const onAddExample = async (ex: Example) => {
    const vocabId = await ensureInVocab();
    const added = await addExampleContext(db, { vocabId, headword: word.headword, en: ex.en, ru: ex.ru, source: ex.source });
    setToast(added
      ? (noTranslation ? 'Пример добавлен, его перевод стал переводом в словаре' : 'Пример добавлен к карточке')
      : 'Этот пример уже добавлен');
    onChanged?.();
  };

  const onOwnTranslation = () => {
    Alert.prompt(
      `Перевод для «${lemma}»`,
      'Несколько вариантов — через точку с запятой',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Сохранить',
          onPress: async (text?: string) => {
            const list = (text ?? '').split(';').map((s) => s.trim()).filter(Boolean);
            if (list.length === 0) return;
            const vocabId = await ensureInVocab();
            await setVocabTranslations(db, vocabId, list);
            setToast(`Перевод сохранён: ${list.join('; ')}`);
            onChanged?.();
          },
        },
      ],
      'plain-text',
    );
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lemma} numberOfLines={2}>{lemma}</Text>
            <View style={styles.subRow}>
              {entry?.ipa ? <Text style={styles.ipa}>/{entry.ipa}/</Text> : null}
              {pos ? <Text style={styles.pos}>{pos}</Text> : null}
              {word.normalized !== lemma && !phraseFallback ? <Text style={styles.form}>в тексте: {word.normalized}</Text> : null}
            </View>
          </View>
          <Pressable onPress={() => speak(lemma)} style={styles.iconBtn} accessibilityLabel="Озвучить"><Text style={styles.icon}>🔊</Text></Pressable>
          <Pressable onPress={onClose} style={styles.iconBtn} accessibilityLabel="Закрыть"><Text style={styles.close}>✕</Text></Pressable>
        </View>

        <View style={styles.tabs}>
          <Pressable style={[styles.tab, tab === 'translation' && styles.tabActive]} onPress={() => setTab('translation')}>
            <Text style={[styles.tabText, tab === 'translation' && styles.tabTextActive]}>Перевод</Text>
          </Pressable>
          <Pressable style={[styles.tab, tab === 'examples' && styles.tabActive]} onPress={() => setTab('examples')}>
            <Text style={[styles.tabText, tab === 'examples' && styles.tabTextActive]}>
              Примеры{examples ? ` · ${examples.length}` : ''}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {tab === 'translation' ? (
            <>
              {phraseFallback ? (
                <View style={styles.block}>
                  <Text style={styles.missing}>Такой фразы в словаре нет. Загляните во вкладку «Примеры» или в Reverso, перевод можно вписать кнопкой «Свой перевод».</Text>
                  {supportEntry ? (
                    <View style={styles.support}>
                      <Text style={styles.entryHead}>{supportEntry.lemma} <Text style={styles.pos}>{supportEntry.pos}</Text>{supportEntry.ipa ? <Text style={styles.ipa}> /{supportEntry.ipa}/</Text> : null}</Text>
                      {supportEntry.senses.slice(0, 4).map((s, i) => <Text key={i} style={styles.sense}>{i + 1}. {s}</Text>)}
                    </View>
                  ) : null}
                </View>
              ) : word.entries.length === 0 ? (
                <Text style={styles.missing}>
                  {word.maybeProperNoun ? 'Похоже на имя собственное.' : 'Этого слова нет в словаре.'} Посмотрите «Примеры» или Reverso; перевод можно вписать кнопкой «Свой перевод».
                </Text>
              ) : (
                word.entries.map((e) => (
                  <View key={e.id} style={styles.block}>
                    {word.entries.length > 1 ? (
                      <Text style={styles.entryHead}>{e.lemma} <Text style={styles.pos}>{e.pos}</Text>{e.ipa && e.id !== entry?.id ? <Text style={styles.ipa}> /{e.ipa}/</Text> : null}</Text>
                    ) : null}
                    {e.senses.map((s, i) => <Text key={i} style={styles.sense}>{i + 1}. {s}</Text>)}
                  </View>
                ))
              )}
              <Pressable onPress={() => speak(word.sentence)} accessibilityLabel="Озвучить предложение">
                <Text style={styles.context}>« {word.sentence} »</Text>
              </Pressable>
            </>
          ) : (
            <>
              {loadingExamples ? (
                <View style={styles.loading}><ActivityIndicator /><Text style={styles.note}>Ищем примеры в Tatoeba…</Text></View>
              ) : null}
              {examplesNote ? <Text style={styles.note}>{examplesNote}</Text> : null}
              {(examples ?? []).map((ex, i) => (
                <View key={i} style={styles.example}>
                  <Pressable onPress={() => speak(ex.en)}><Text style={styles.exEn}>{ex.en}</Text></Pressable>
                  <Text style={styles.exRu}>{ex.ru}</Text>
                  <View style={styles.exFooter}>
                    <Text style={styles.exSrc}>{ex.source}{ex.license ? ` · ${ex.license}` : ''}</Text>
                    <Pressable onPress={() => onAddExample(ex)} hitSlop={6} style={styles.exAddBtn}>
                      <Text style={styles.exAdd}>{status ? '+ к карточке' : '+ в словарь с примером'}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
              <Pressable style={styles.reversoRow} onPress={() => WebBrowser.openBrowserAsync(reversoUrl(word.headword))}>
                <Text style={styles.reversoText}>Больше примеров в Reverso Context ↗</Text>
              </Pressable>
            </>
          )}
        </ScrollView>

        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onAdd}>
            <Text style={styles.btnPrimaryText}>{status ? `В словаре · ${status.seen_count}` : 'В словарь'}</Text>
          </Pressable>
          {noTranslation ? (
            <Pressable style={styles.btn} onPress={onOwnTranslation}><Text style={styles.btnText}>Свой перевод</Text></Pressable>
          ) : null}
          <Pressable style={styles.btn} onPress={() => WebBrowser.openBrowserAsync(reversoUrl(word.headword))}>
            <Text style={styles.btnText}>Reverso ↗</Text>
          </Pressable>
        </View>
        {toast ? <Text style={styles.toast}>{toast}</Text> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '78%', paddingBottom: 20 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#ddd', marginTop: 8 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 16, paddingTop: 10 },
  lemma: { fontSize: 26, fontWeight: '700' },
  subRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginTop: 2 },
  ipa: { fontSize: 15, color: '#555' },
  pos: { fontSize: 13, color: '#8a6d3b', fontStyle: 'italic' },
  form: { color: '#666', fontSize: 13 },
  iconBtn: { padding: 6 },
  icon: { fontSize: 20 },
  close: { fontSize: 18, color: '#666', fontWeight: '600' },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginTop: 10, backgroundColor: '#eef1f5', borderRadius: 10, padding: 3 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: '#2f6fed' },
  tabText: { fontWeight: '600', color: '#334' },
  tabTextActive: { color: '#fff' },
  content: { padding: 16, gap: 10 },
  block: { gap: 3 },
  support: { marginTop: 8, gap: 2, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: '#dde3ea' },
  entryHead: { fontWeight: '600' },
  sense: { fontSize: 17, lineHeight: 23 },
  missing: { color: '#a33', fontSize: 15, lineHeight: 21 },
  context: { color: '#333', fontStyle: 'italic', marginTop: 6, lineHeight: 20 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  note: { color: '#666', fontSize: 13 },
  example: { gap: 3, borderLeftWidth: 2, borderLeftColor: '#dde3ea', paddingLeft: 10, paddingVertical: 2 },
  exEn: { fontSize: 16 },
  exRu: { fontSize: 15, color: '#444' },
  exFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  exSrc: { fontSize: 11, color: '#888', flex: 1 },
  exAddBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, backgroundColor: '#eef1f5' },
  exAdd: { fontSize: 12, color: '#2f6fed', fontWeight: '700' },
  reversoRow: { paddingVertical: 10 },
  reversoText: { color: '#2f6fed', fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e7eb', flexWrap: 'wrap' },
  btn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#eef1f5' },
  btnText: { fontWeight: '600', color: '#223' },
  btnPrimary: { backgroundColor: '#2f6fed' },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  toast: { color: '#2b7a3d', fontSize: 13, paddingHorizontal: 16, paddingTop: 8 },
});
