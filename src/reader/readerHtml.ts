// HTML-страница читалки для WebView: epub.js + мост тапа по слову.
// Сообщения в RN (postMessage, JSON):
//   {type:'loaded'}                         — страница готова принимать __openBook
//   {type:'ready', title}                   — книга распакована, locations посчитаны
//   {type:'relocated', cfi, percent}        — позиция чтения
//   {type:'word', word, sentence, prev, next, cfi} — тап по слову
//   {type:'miss'}                           — тап не по тексту
//   {type:'error', message}
// Команды из RN: window.__openBook(base64, cfi, {fontSize}), __next(), __prev(), __setFontSize(percent)
import { EPUBJS, JSZIP } from './vendor.generated';

export const readerHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #fff; }
  #viewer { width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="viewer"></div>
<script>${JSZIP}</script>
<script>${EPUBJS}</script>
<script>
(function () {
  var post = function (m) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m));
  };
  var book = null, rendition = null;
  var WORD_CHAR = /[A-Za-z\\u00C0-\\u024F'\\u2019-]/;
  var BLOCK = /^(P|DIV|LI|BLOCKQUOTE|H[1-6]|TD|DD|DT|BODY|SECTION|ARTICLE)$/;

  function expandWord(text, offset) {
    var s = offset, e = offset;
    while (s > 0 && WORD_CHAR.test(text[s - 1])) s--;
    while (e < text.length && WORD_CHAR.test(text[e])) e++;
    return { start: s, end: e, word: text.slice(s, e) };
  }

  function blockOf(node) {
    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el && !BLOCK.test(el.tagName)) el = el.parentElement;
    return el || node.ownerDocument.body;
  }

  // Текст блока целиком + позиция тапнутого слова в нём → предложение и соседние слова.
  function contextAt(block, node, offsetInNode, wordLen) {
    var full = '', pos = -1;
    var walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      if (n === node) pos = full.length + offsetInNode;
      full += n.textContent;
    }
    full = full.replace(/\\s+/g, ' ');
    if (pos < 0) return { sentence: full.trim(), prev: '', next: '' };
    var s = pos, e = pos + wordLen;
    while (s > 0 && !/[.!?]/.test(full[s - 1])) s--;
    while (e < full.length && !/[.!?]/.test(full[e])) e++;
    if (e < full.length) e++;
    var before = full.slice(0, pos).match(/([A-Za-z\\u00C0-\\u024F'\\u2019-]+)[^A-Za-z\\u00C0-\\u024F]*$/);
    var after = full.slice(pos + wordLen).match(/^[^A-Za-z\\u00C0-\\u024F]*([A-Za-z\\u00C0-\\u024F'\\u2019-]+)/);
    return {
      sentence: full.slice(s, e).trim(),
      prev: before ? before[1] : '',
      next: after ? after[1] : ''
    };
  }

  function handleTap(contents, x, y) {
    var doc = contents.document;
    var range = null;
    if (doc.caretRangeFromPoint) {
      range = doc.caretRangeFromPoint(x, y);
    } else if (doc.caretPositionFromPoint) {
      var p = doc.caretPositionFromPoint(x, y);
      if (p) { range = doc.createRange(); range.setStart(p.offsetNode, p.offset); range.collapse(true); }
    }
    if (!range || !range.startContainer || range.startContainer.nodeType !== 3) { post({ type: 'miss' }); return; }
    var node = range.startContainer;
    var w = expandWord(node.textContent || '', range.startOffset);
    if (!w.word || !/[A-Za-z]/.test(w.word)) { post({ type: 'miss' }); return; }
    var r = doc.createRange();
    r.setStart(node, w.start);
    r.setEnd(node, w.end);
    var cfi = '';
    try { cfi = contents.cfiFromRange(r); } catch (e) {}
    var ctx = contextAt(blockOf(node), node, w.start, w.word.length);
    post({ type: 'word', word: w.word, sentence: ctx.sentence, prev: ctx.prev, next: ctx.next, cfi: cfi });
  }

  // Вешаем жесты на документ каждой главы (iframe epub.js).
  function attach(contents) {
    var doc = contents.document;
    var start = null;
    doc.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: Date.now() };
    }, { passive: true });
    doc.addEventListener('touchend', function (e) {
      if (!start) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - start.x, dy = t.clientY - start.y, dt = Date.now() - start.t;
      start = null;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 80) { if (dx < 0) rendition.next(); else rendition.prev(); return; }
      if (dt < 350 && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        var W = doc.documentElement.clientWidth;
        if (t.clientX < W * 0.12) { rendition.prev(); return; }
        if (t.clientX > W * 0.88) { rendition.next(); return; }
        handleTap(contents, t.clientX, t.clientY);
      }
    }, { passive: true });
    // Короткий тап по ссылке — перевод слова, а не переход.
    doc.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a');
      if (a) e.preventDefault();
    }, true);
  }

  window.__openBook = function (b64, cfi, settings) {
    try {
      book = ePub();
      book.open(b64, 'base64');
      rendition = book.renderTo('viewer', { width: '100%', height: '100%', flow: 'paginated', spread: 'none' });
      var fs = (settings && settings.fontSize) || 100;
      rendition.themes.default({ body: { 'padding': '0 10px !important' } });
      rendition.themes.fontSize(fs + '%');
      rendition.hooks.content.register(attach);
      rendition.on('relocated', function (loc) {
        post({ type: 'relocated', cfi: loc.start.cfi, percent: loc.start.percentage || 0 });
      });
      book.ready
        .then(function () { return book.locations.generate(1200); })
        .then(function () {
          var meta = book.packaging && book.packaging.metadata;
          post({ type: 'ready', title: (meta && meta.title) || '', author: (meta && meta.creator) || '' });
        })
        .catch(function (e) { post({ type: 'error', message: String(e) }); });
      rendition.display(cfi || undefined).catch(function (e) { post({ type: 'error', message: String(e) }); });
    } catch (e) {
      post({ type: 'error', message: String(e) });
    }
  };
  window.__next = function () { if (rendition) rendition.next(); };
  window.__prev = function () { if (rendition) rendition.prev(); };
  window.__setFontSize = function (p) { if (rendition) rendition.themes.fontSize(p + '%'); };

  post({ type: 'loaded' });
})();
</script>
</body>
</html>`;
