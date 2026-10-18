// Экран чтения: WebView с epub.js, мост тапа → резолвер → карточка слова, сохранение позиции.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { readerHtml } from '../reader/readerHtml';
import { WebView, type WebViewHandle, type WebViewMessageEvent } from '../reader/WebViewTyped';
import { getReadingState, readBookBase64, saveReadingState, updateBookMeta, type Book } from '../lib/books';
import { resolveWord } from '../lib/wordResolver';
import { WordSheet, type TappedWord } from '../components/WordSheet';

type Msg =
  | { type: 'loaded' }
  | { type: 'ready'; title: string; author: string }
  | { type: 'relocated'; cfi: string; percent: number }
  | { type: 'word'; word: string; sentence: string; prev: string; next: string; cfi: string }
  | { type: 'miss' }
  | { type: 'error'; message: string };

type Props = { book: Book; onBack: () => void };

export function ReaderScreen({ book, onBack }: Props) {
  const db = useSQLiteContext();
  const webRef = useRef<WebViewHandle>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [percent, setPercent] = useState(book.percent);
  const [fontSize, setFontSize] = useState(100);
  const [tapped, setTapped] = useState<TappedWord | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCfi = useRef<string | null>(null);

  const inject = useCallback((js: string) => {
    webRef.current?.injectJavaScript(`${js}; true;`);
  }, []);

  const openBook = useCallback(async () => {
    try {
      const [b64, state] = await Promise.all([readBookBase64(book.file_path), getReadingState(db, book.id)]);
      setFontSize(state.font_size);
      inject(`window.__openBook(${JSON.stringify(b64)}, ${JSON.stringify(state.cfi)}, { fontSize: ${state.font_size} })`);
    } catch (e) {
      setStatus('error');
      Alert.alert('Не удалось открыть книгу', String(e));
    }
  }, [book, db, inject]);

  const onMessage = useCallback(async (event: WebViewMessageEvent) => {
    let msg: Msg;
    try { msg = JSON.parse(event.nativeEvent.data) as Msg; } catch { return; }
    switch (msg.type) {
      case 'loaded':
        void openBook();
        break;
      case 'ready':
        setStatus('ready');
        void updateBookMeta(db, book.id, msg.title, msg.author);
        break;
      case 'relocated':
        setPercent(msg.percent);
        lastCfi.current = msg.cfi;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          void saveReadingState(db, book.id, { cfi: msg.cfi, percent: msg.percent });
        }, 1000);
        break;
      case 'word': {
        const sentenceStart = msg.sentence.replace(/^[^A-Za-z]+/, '').startsWith(msg.word.replace(/^[^A-Za-z]+/, ''));
        const resolved = await resolveWord(db, msg.word, { prev: msg.prev, next: msg.next }, { sentenceStart });
        setTapped({ ...resolved, sentence: msg.sentence, cfi: msg.cfi, bookId: book.id });
        break;
      }
      case 'error':
        setStatus('error');
        Alert.alert('Ошибка читалки', msg.message.includes('encrypt') ? 'Книга защищена DRM и не может быть открыта' : msg.message);
        break;
      default:
        break;
    }
  }, [book.id, db, openBook]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (lastCfi.current) void saveReadingState(db, book.id, { cfi: lastCfi.current, percent });
  }, [book.id, db, percent]);

  const changeFont = (delta: number) => {
    const next = Math.min(180, Math.max(70, fontSize + delta));
    setFontSize(next);
    inject(`window.__setFontSize(${next})`);
    void saveReadingState(db, book.id, { font_size: next });
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Библиотека</Text></Pressable>
        <Text style={styles.title} numberOfLines={1}>{book.title}</Text>
        <Pressable onPress={() => changeFont(-10)} hitSlop={8}><Text style={styles.fontBtn}>A−</Text></Pressable>
        <Pressable onPress={() => changeFont(10)} hitSlop={8}><Text style={styles.fontBtn}>A+</Text></Pressable>
      </View>
      <View style={styles.webWrap}>
        <WebView
          ref={webRef}
          source={{ html: readerHtml }}
          originWhitelist={['*']}
          onMessage={onMessage}
          javaScriptEnabled
          allowFileAccess
          allowingReadAccessToURL="/"
          scrollEnabled={false}
          bounces={false}
          onShouldStartLoadWithRequest={(req: { url: string }) =>
            req.url === 'about:blank' || req.url.startsWith('blob:') || req.url.startsWith('data:')
          }
          style={styles.web}
        />
        {status === 'loading' ? (
          <View style={styles.overlay}><ActivityIndicator size="large" /><Text style={styles.overlayText}>Открываем книгу…</Text></View>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Text style={styles.progress}>{Math.round(percent * 100)} %</Text>
        <Text style={styles.hint}>тап по слову — перевод · края и свайп — листать</Text>
      </View>
      <WordSheet word={tapped} onClose={() => setTapped(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  back: { color: '#2f6fed', fontSize: 16 },
  title: { flex: 1, fontSize: 15, fontWeight: '600' },
  fontBtn: { fontSize: 16, fontWeight: '600', color: '#333' },
  webWrap: { flex: 1 },
  web: { flex: 1, backgroundColor: '#fff' },
  overlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', gap: 12 },
  overlayText: { color: '#666' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 6 },
  progress: { color: '#666', fontSize: 12 },
  hint: { color: '#999', fontSize: 11 },
});
