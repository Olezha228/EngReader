// Скрытый WebView, который открывает страницу Reverso Context и вытаскивает пары «пример — перевод».
// Прямой запрос к их сервису закрыт Cloudflare (403 вне браузера), а настоящий браузерный движок проходит
// проверку сам. Это неофициальный путь: ToS Reverso его не разрешает, вёрстка может смениться — тогда
// остаётся кнопка «Открыть в Reverso». Для публикации в App Store источник выключается (REVERSO_SCRAPE_ENABLED).
import { useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { reversoUrl, type Example } from '../lib/examples';
import { WebView, type WebViewMessageEvent } from '../reader/WebViewTyped';

export const REVERSO_SCRAPE_ENABLED = true;
const MAX_EXAMPLES = 6;
const TIMEOUT_MS = 15000;

type Props = { query: string; onResult: (examples: Example[], error?: string) => void };

// Выполняется в странице Reverso после каждой загрузки (в том числе после интерстишла Cloudflare).
const EXTRACTOR = `
(function () {
  if (window.__erDone) return;
  var started = Date.now();
  function send(m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function clean(s) { return (s || '').replace(/\\s+/g, ' ').trim(); }
  function tryExtract() {
    var nodes = document.querySelectorAll('#examples-content .example, .example');
    var out = [];
    for (var i = 0; i < nodes.length && out.length < ${MAX_EXAMPLES}; i++) {
      var src = nodes[i].querySelector('.src .text, .src');
      var trg = nodes[i].querySelector('.trg .text, .trg');
      var en = clean(src && src.innerText), ru = clean(trg && trg.innerText);
      if (en && ru) out.push({ en: en, ru: ru });
    }
    if (out.length) { window.__erDone = true; send({ type: 'reverso', examples: out }); return true; }
    var title = (document.title || '').toLowerCase();
    var challenge = title.indexOf('just a moment') >= 0 || !!document.querySelector('#challenge-running, #cf-challenge-running');
    var noResults = !!document.querySelector('#no-results, .no-results, .no-example');
    if (noResults) { window.__erDone = true; send({ type: 'reverso', examples: [] }); return true; }
    if (Date.now() - started > ${TIMEOUT_MS}) { window.__erDone = true; send({ type: 'reverso', examples: [], error: challenge ? 'cloudflare' : 'timeout' }); return true; }
    return false;
  }
  if (!tryExtract()) {
    var timer = setInterval(function () { if (tryExtract()) clearInterval(timer); }, 500);
  }
})(); true;
`;

export function ReversoFetcher({ query, onResult }: Props) {
  const done = useRef(false);
  const url = useMemo(() => reversoUrl(query), [query]);

  const onMessage = (e: WebViewMessageEvent) => {
    if (done.current) return;
    try {
      const msg = JSON.parse(e.nativeEvent.data) as { type: string; examples?: { en: string; ru: string }[]; error?: string };
      if (msg.type !== 'reverso') return;
      done.current = true;
      const examples: Example[] = (msg.examples ?? []).map((x) => ({ en: x.en, ru: x.ru, source: 'Reverso Context', url }));
      console.log('[examples] reverso', query, 'results:', examples.length, msg.error ?? '');
      onResult(examples, msg.error);
    } catch { /* чужое сообщение */ }
  };

  return (
    <View style={styles.hidden} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView
        source={{ uri: url }}
        injectedJavaScript={EXTRACTOR}
        javaScriptEnabled
        sharedCookiesEnabled
        onMessage={onMessage}
        onError={(ev) => { if (!done.current) { done.current = true; onResult([], ev.nativeEvent.description); } }}
        onHttpError={(ev) => { if (!done.current && ev.nativeEvent.statusCode >= 400 && ev.nativeEvent.statusCode !== 403) { done.current = true; onResult([], `http ${ev.nativeEvent.statusCode}`); } }}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10, overflow: 'hidden' },
  web: { width: 390, height: 600 },
});
