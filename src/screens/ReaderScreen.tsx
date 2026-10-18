// Экран чтения: WebView с epub.js. Одиночный тап — панель прогресса и оглавления, двойной — карточка слова,
// края и свайп — листание. Позиция, шрифт и тема сохраняются.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, Pressable, SafeAreaView, StyleSheet, Text, View,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { readerHtml } from '../reader/readerHtml';
import { WebView, type WebViewHandle, type WebViewMessageEvent } from '../reader/WebViewTyped';
import {
  getReadingState, readBookBase64, READER_THEMES, saveReadingState, updateBookMeta, type Book, type ReaderTheme,
} from '../lib/books';
import { knownWords } from '../lib/vocab';
import { resolvePhrase, resolveWord } from '../lib/wordResolver';
import { WordSheet, type TappedWord } from '../components/WordSheet';

const THEME_LABEL: Record<ReaderTheme, string> = { light: 'Светлая', sepia: 'Сепия', dark: 'Тёмная' };
const THEME_BG: Record<ReaderTheme, string> = { light: '#ffffff', sepia: '#f4ecd8', dark: '#121212' };
const THEME_FG: Record<ReaderTheme, string> = { light: '#333', sepia: '#5b4636', dark: '#d6d6d6' };
const THEME_PANEL: Record<ReaderTheme, string> = { light: '#f3f4f6', sepia: '#e9dfc7', dark: '#1e1e1e' };
const CONTROLS_HIDE_MS = 6000;

type TocItem = { label: string; href: string; depth: number };

type Msg =
  | { type: 'loaded' }
  | { type: 'ready'; title: string; author: string }
  | { type: 'relocated'; cfi: string; percent: number; href: string }
  | { type: 'tap' }
  | { type: 'toc'; items: TocItem[] }
  | { type: 'word'; word: string; sentence: string; prev: string; next: string; cfi: string; selection?: boolean }
  | { type: 'too_long'; words: number }
  | { type: 'miss' }
  | { type: 'debug'; msg: string }
  | { type: 'error'; message: string; code?: string };

type Props = { book: Book; onBack: () => void };

/** Глава по href текущей позиции: совпадение по пути без якоря, берём последний подходящий пункт. */
function chapterFor(toc: TocItem[], href: string): TocItem | null {
  if (!href) return null;
  const path = href.split('#')[0];
  let found: TocItem | null = null;
  for (const item of toc) {
    const itemPath = item.href.split('#')[0];
    if (itemPath === path || path.endsWith(itemPath) || itemPath.endsWith(path)) found = found && item.href.includes('#') ? found : item;
  }
  return found;
}

export function ReaderScreen({ book, onBack }: Props) {
  const db = useSQLiteContext();
  const webRef = useRef<WebViewHandle>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [percent, setPercent] = useState(book.percent);
  const [href, setHref] = useState('');
  const [fontSize, setFontSize] = useState(100);
  const [theme, setTheme] = useState<ReaderTheme>('light');
  const [tapped, setTapped] = useState<TappedWord | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [controls, setControls] = useState(false);
  const [barWidth, setBarWidth] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCfi = useRef<string | null>(null);

  const inject = useCallback((js: string) => {
    webRef.current?.injectJavaScript(`${js}; true;`);
  }, []);

  const showControls = useCallback((visible: boolean) => {
    setControls(visible);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (visible) hideTimer.current = setTimeout(() => setControls(false), CONTROLS_HIDE_MS);
  }, []);

  const refreshKnown = useCallback(async () => {
    const words = await knownWords(db);
    inject(`window.__setKnown(${JSON.stringify(words)})`);
  }, [db, inject]);

  const openBook = useCallback(async () => {
    try {
      const [b64, state, known] = await Promise.all([
        readBookBase64(book.file_path), getReadingState(db, book.id), knownWords(db),
      ]);
      setFontSize(state.font_size);
      setTheme(state.theme);
      const settings = { fontSize: state.font_size, theme: state.theme, known };
      console.log('[reader] openBook', book.title, 'base64 chars:', b64.length, 'cfi:', state.cfi);
      inject(`window.__openBook(${JSON.stringify(b64)}, ${JSON.stringify(state.cfi)}, ${JSON.stringify(settings)})`);
    } catch (e) {
      setStatus('error');
      Alert.alert('Не удалось открыть книгу', String(e));
    }
  }, [book, db, inject]);

  const onMessage = useCallback(async (event: WebViewMessageEvent) => {
    let msg: Msg;
    try { msg = JSON.parse(event.nativeEvent.data) as Msg; } catch { return; }
    if (msg.type !== 'relocated' && msg.type !== 'toc') {
      console.log('[reader]', msg.type, 'msg' in msg ? msg.msg : 'message' in msg ? msg.message : 'word' in msg ? `«${msg.word}»` : '');
    }
    switch (msg.type) {
      case 'loaded':
        void openBook();
        break;
      case 'debug':
        break;
      case 'ready':
        setStatus('ready');
        void updateBookMeta(db, book.id, msg.title, msg.author);
        break;
      case 'toc':
        setToc(msg.items.filter((i) => i.label));
        break;
      case 'tap':
        setControls((v) => {
          const next = !v;
          if (hideTimer.current) clearTimeout(hideTimer.current);
          if (next) hideTimer.current = setTimeout(() => setControls(false), CONTROLS_HIDE_MS);
          return next;
        });
        break;
      case 'relocated':
        setPercent(msg.percent);
        setHref(msg.href);
        lastCfi.current = msg.cfi;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          void saveReadingState(db, book.id, { cfi: msg.cfi, percent: msg.percent });
        }, 1000);
        break;
      case 'word': {
        const sentenceStart = msg.sentence.replace(/^[^A-Za-z]+/, '').startsWith(msg.word.replace(/^[^A-Za-z]+/, ''));
        const resolved = msg.selection || /\s/.test(msg.word.trim())
          ? await resolvePhrase(db, msg.word)
          : await resolveWord(db, msg.word, { prev: msg.prev, next: msg.next }, { sentenceStart });
        setControls(false);
        setTapped({ ...resolved, sentence: msg.sentence, cfi: msg.cfi, bookId: book.id });
        break;
      }
      case 'too_long':
        Alert.alert('Слишком длинно', `Выделено ${msg.words} слов. Словарь переводит до 5 слов — выделите короче.`);
        break;
      case 'error':
        setStatus('error');
        Alert.alert(
          'Не удалось открыть книгу',
          msg.code === 'drm' || /encrypt/i.test(msg.message)
            ? 'Книга защищена DRM (куплена в Kindle, Apple Books, ЛитРес и т. п.) — такие файлы открыть нельзя.'
            : `Файл повреждён или это не EPUB.\n${msg.message}`,
        );
        break;
      default:
        break;
    }
  }, [book.id, db, openBook]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (lastCfi.current) void saveReadingState(db, book.id, { cfi: lastCfi.current, percent });
  }, [book.id, db, percent]);

  const changeFont = (delta: number) => {
    const next = Math.min(180, Math.max(70, fontSize + delta));
    setFontSize(next);
    inject(`window.__setFontSize(${next})`);
    void saveReadingState(db, book.id, { font_size: next });
    showControls(true);
  };

  const cycleTheme = () => {
    const next = READER_THEMES[(READER_THEMES.indexOf(theme) + 1) % READER_THEMES.length];
    setTheme(next);
    inject(`window.__setTheme(${JSON.stringify(next)})`);
    void saveReadingState(db, book.id, { theme: next });
    showControls(true);
  };

  const goTo = (item: TocItem) => {
    setTocOpen(false);
    inject(`window.__goTo(${JSON.stringify(item.href)})`);
    showControls(true);
  };

  const onBarPress = (x: number) => {
    if (barWidth <= 0) return;
    const p = Math.min(1, Math.max(0, x / barWidth));
    inject(`window.__goPercent(${p.toFixed(4)})`);
    showControls(true);
  };

  const chapter = useMemo(() => chapterFor(toc, href), [toc, href]);
  const fg = { color: THEME_FG[theme] };
  const panelBg = { backgroundColor: THEME_PANEL[theme] };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: THEME_BG[theme] }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Библиотека</Text></Pressable>
        <Text style={[styles.title, fg]} numberOfLines={1}>{book.title}</Text>
        <Pressable onPress={cycleTheme} hitSlop={8} accessibilityLabel={`Тема: ${THEME_LABEL[theme]}`}>
          <Text style={[styles.fontBtn, fg]}>◐</Text>
        </Pressable>
        <Pressable onPress={() => changeFont(-10)} hitSlop={8}><Text style={[styles.fontBtn, fg]}>A−</Text></Pressable>
        <Pressable onPress={() => changeFont(10)} hitSlop={8}><Text style={[styles.fontBtn, fg]}>A+</Text></Pressable>
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
          onShouldStartLoadWithRequest={(req: { url: string }) => {
            const ok = req.url.startsWith('about:') || req.url.startsWith('blob:') || req.url.startsWith('data:') || req.url.startsWith('file:');
            if (!ok) console.log('[reader] blocked navigation', req.url);
            return ok;
          }}
          onError={(e) => { console.log('[reader] webview error', e.nativeEvent.description); setStatus('error'); }}
          onContentProcessDidTerminate={() => { console.log('[reader] webview process terminated'); Alert.alert('Читалка перезапущена', 'iOS выгрузил страницу из памяти. Откройте книгу ещё раз.'); }}
          style={[styles.web, { backgroundColor: THEME_BG[theme] }]}
        />
        {status === 'loading' ? (
          <View style={[styles.overlay, { backgroundColor: THEME_BG[theme] }]}>
            <ActivityIndicator size="large" /><Text style={styles.overlayText}>Открываем книгу…</Text>
          </View>
        ) : null}

        {controls ? (
          <View style={[styles.controls, panelBg]}>
            <View style={styles.controlsRow}>
              <Pressable onPress={() => { inject('window.__prev()'); showControls(true); }} hitSlop={10} style={styles.navBtn}>
                <Text style={[styles.navText, fg]}>‹</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={[styles.chapter, fg]} numberOfLines={1}>{chapter?.label ?? book.title}</Text>
                <Pressable
                  onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
                  onPress={(e) => onBarPress(e.nativeEvent.locationX)}
                  style={styles.barHit}
                  accessibilityLabel="Прогресс чтения, нажмите, чтобы перейти"
                >
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${Math.round(percent * 100)}%` }]} />
                  </View>
                </Pressable>
                <Text style={[styles.percent, fg]}>{Math.round(percent * 100)} % прочитано</Text>
              </View>
              <Pressable onPress={() => { inject('window.__next()'); showControls(true); }} hitSlop={10} style={styles.navBtn}>
                <Text style={[styles.navText, fg]}>›</Text>
              </Pressable>
            </View>
            <View style={styles.controlsRow}>
              <Pressable style={styles.tocBtn} onPress={() => setTocOpen(true)} disabled={toc.length === 0}>
                <Text style={styles.tocBtnText}>{toc.length ? `Оглавление · ${toc.length}` : 'Оглавления нет'}</Text>
              </Pressable>
              <Text style={styles.hint}>двойной тап — перевод · свайп — листать</Text>
            </View>
          </View>
        ) : null}
      </View>

      <Modal visible={tocOpen} animationType="slide" onRequestClose={() => setTocOpen(false)}>
        <SafeAreaView style={[styles.tocRoot, { backgroundColor: THEME_BG[theme] }]}>
          <View style={styles.header}>
            <Pressable onPress={() => setTocOpen(false)} hitSlop={10}><Text style={styles.back}>‹ Назад</Text></Pressable>
            <Text style={[styles.title, fg]} numberOfLines={1}>Оглавление</Text>
          </View>
          <FlatList
            data={toc}
            keyExtractor={(item, i) => `${item.href}-${i}`}
            contentContainerStyle={styles.tocList}
            renderItem={({ item }) => {
              const current = chapter?.href === item.href;
              return (
                <Pressable onPress={() => goTo(item)} style={[styles.tocItem, { paddingLeft: 16 + item.depth * 18 }, current && styles.tocItemCurrent]}>
                  <Text style={[styles.tocLabel, fg, current && styles.tocLabelCurrent]} numberOfLines={2}>{item.label}</Text>
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>

      <WordSheet word={tapped} onClose={() => setTapped(null)} onChanged={() => void refreshKnown()} />
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
  controls: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 8,
    borderTopLeftRadius: 16, borderTopRightRadius: 16, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: -2 },
  },
  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  navBtn: { paddingHorizontal: 8, paddingVertical: 2 },
  navText: { fontSize: 30, fontWeight: '600', lineHeight: 34 },
  chapter: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  barHit: { paddingVertical: 6 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.25)', overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: '#2f6fed' },
  percent: { fontSize: 12, opacity: 0.8, marginTop: 4 },
  tocBtn: { backgroundColor: '#2f6fed', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  tocBtnText: { color: '#fff', fontWeight: '700' },
  hint: { flex: 1, color: '#999', fontSize: 11, textAlign: 'right' },
  tocRoot: { flex: 1 },
  tocList: { paddingBottom: 32 },
  tocItem: { paddingVertical: 12, paddingRight: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.3)' },
  tocItemCurrent: { backgroundColor: 'rgba(47,111,237,0.12)' },
  tocLabel: { fontSize: 16 },
  tocLabelCurrent: { fontWeight: '700', color: '#2f6fed' },
});
