// HTML-страница читалки для WebView: epub.js + мост тапа по слову.
// Сообщения в RN (postMessage, JSON):
//   {type:'loaded'}                         — страница готова принимать __openBook
//   {type:'ready', title}                   — книга распакована, locations посчитаны
//   {type:'relocated', cfi, percent}        — позиция чтения
//   {type:'word', word, sentence, prev, next, cfi, selection?} — тап по слову или выделенная фраза (≤ 5 слов)
//   {type:'too_long', words}                — выделено больше 5 слов
//   {type:'miss'}                           — тап не по тексту
//   {type:'error', message, code?}          — code 'drm' — книга зашифрована
// Команды из RN: window.__openBook(base64, cfi, {fontSize, theme, known}), __next(), __prev(),
//   __setFontSize(percent), __setTheme('light'|'sepia'|'dark'), __setKnown(string[])
import { EPUBJS, JSZIP } from './vendor.generated';

export const readerHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #fff; -webkit-touch-callout: none; }
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
  window.onerror = function (msg, src, line, col) {
    post({ type: 'error', message: String(msg) + ' @' + line + ':' + col });
  };
  window.addEventListener('unhandledrejection', function (e) {
    post({ type: 'error', message: 'unhandled: ' + String(e.reason && (e.reason.message || e.reason)) });
  });
  post({ type: 'debug', msg: 'libs: JSZip=' + typeof JSZip + ' ePub=' + typeof ePub + ' vw=' + window.innerWidth + 'x' + window.innerHeight });
  var book = null, rendition = null;
  var WORD_CHAR = /[A-Za-z\\u00C0-\\u024F'\\u2019-]/;
  var THEMES = {
    light: { body: { background: '#ffffff', color: '#1a1a1a' } },
    sepia: { body: { background: '#f4ecd8', color: '#5b4636' } },
    dark:  { body: { background: '#121212', color: '#d6d6d6' } }
  };
  var KNOWN_STYLE = { 'mark.er-known': { background: 'transparent', color: 'inherit', 'border-bottom': '2px solid rgba(47,111,237,0.55)' } };
  var knownRe = null;

  function escRe(s) { return s.replace(/[.*+?^$\\{\\}()|\\[\\]\\\\]/g, '\\\\$&'); }
  function setKnownList(list) {
    list = (list || []).filter(function (w) { return w && /^[A-Za-z][A-Za-z'\\u2019-]*( [A-Za-z'\\u2019-]+)?$/.test(w); }).slice(0, 3000);
    knownRe = list.length ? new RegExp('\\\\b(' + list.map(escRe).join('|') + ')\\\\b', 'gi') : null;
  }
  // Подчёркиваем слова из словаря: оборачиваем совпадения в <mark>, не трогая разметку.
  function highlightKnown(doc) {
    if (!knownRe || !doc || !doc.body) return;
    var walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = n.parentElement;
        if (!p || /^(SCRIPT|STYLE|MARK|TITLE)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var text = node.nodeValue;
      knownRe.lastIndex = 0;
      if (!knownRe.test(text)) return;
      knownRe.lastIndex = 0;
      var frag = doc.createDocumentFragment(), last = 0, m;
      while ((m = knownRe.exec(text))) {
        if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
        var mark = doc.createElement('mark');
        mark.className = 'er-known';
        mark.textContent = m[0];
        frag.appendChild(mark);
        last = m.index + m[0].length;
      }
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }
  function unhighlight(doc) {
    if (!doc || !doc.body) return;
    var marks = doc.body.querySelectorAll('mark.er-known');
    for (var i = 0; i < marks.length; i++) {
      var mk = marks[i];
      mk.parentNode.replaceChild(doc.createTextNode(mk.textContent), mk);
    }
    doc.body.normalize();
  }
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

  // Выделение пальцем (долгое нажатие + ручки): ждём, пока оно устоится, и отдаём фразу до 5 слов.
  var selTimer = null, lastSelection = '';
  function watchSelection(contents) {
    var doc = contents.document;
    try { doc.body.style.webkitTouchCallout = 'none'; } catch (e) {}
    doc.addEventListener('selectionchange', function () {
      if (selTimer) clearTimeout(selTimer);
      selTimer = setTimeout(function () {
        var sel = doc.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) { lastSelection = ''; return; }
        var text = sel.toString().replace(/\\s+/g, ' ').trim();
        if (!text || text === lastSelection) return;
        lastSelection = text;
        var words = text.split(' ').filter(Boolean);
        if (words.length > 5) { post({ type: 'too_long', words: words.length }); return; }
        var range = sel.getRangeAt(0);
        var cfi = '';
        try { cfi = contents.cfiFromRange(range); } catch (e) {}
        var node = range.startContainer.nodeType === 3 ? range.startContainer : range.startContainer.firstChild || range.startContainer;
        var ctx = contextAt(blockOf(node), node, range.startOffset, text.length);
        post({ type: 'word', word: text, sentence: ctx.sentence, prev: '', next: '', cfi: cfi, selection: true });
      }, 700);
    });
  }

  // Диагностика касаний: куда они приходят — во внешнюю страницу или в iframe главы.
  var touchDiag = 0;
  document.addEventListener('touchstart', function (e) {
    if (touchDiag++ < 3) post({ type: 'debug', msg: 'outer touchstart target=' + (e.target && e.target.tagName) + ' at ' + Math.round(e.touches[0].clientX) + ',' + Math.round(e.touches[0].clientY) });
  }, { passive: true, capture: true });
  document.addEventListener('pointerdown', function (e) {
    if (touchDiag++ < 6) post({ type: 'debug', msg: 'outer pointerdown target=' + (e.target && e.target.tagName) });
  }, { passive: true, capture: true });

  // Вешаем жесты на документ каждой главы (iframe epub.js).
  function attach(contents) {
    var doc = contents.document;
    var start = null;
    post({ type: 'debug', msg: 'attach hook: doc=' + (doc && doc.readyState) + ' sameDoc=' + (document.querySelector('iframe') && document.querySelector('iframe').contentDocument === doc) });
    ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'click'].forEach(function (ev) {
      doc.addEventListener(ev, function (e) { if (touchDiag++ < 12) post({ type: 'debug', msg: 'iframe ' + ev + ' target=' + (e.target && e.target.tagName) }); }, { passive: true, capture: true });
    });
    try {
      var ifr = document.querySelector('iframe');
      post({ type: 'debug', msg: 'iframe attrs: sandbox=' + ifr.getAttribute('sandbox') + ' pe=' + getComputedStyle(ifr).pointerEvents + ' z=' + getComputedStyle(ifr).zIndex + ' topEl=' + (document.elementFromPoint(200, 300) && document.elementFromPoint(200, 300).tagName) });
    } catch (e) {}
    highlightKnown(doc);
    watchSelection(contents);
    doc.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: Date.now() };
    }, { passive: true });
    doc.addEventListener('touchend', function (e) {
      if (!start) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - start.x, dy = t.clientY - start.y, dt = Date.now() - start.t;
      start = null;
      var sel = doc.getSelection();
      if (sel && !sel.isCollapsed) return; // идёт выделение фразы — не листаем и не ищем слово под пальцем
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
      // allowScriptedContent: без allow-scripts в sandbox iframe WebKit не вызывает обработчики событий
      // внутри главы — тапы и свайпы по тексту просто не доходят.
      rendition = book.renderTo('viewer', { width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: true });
      var fs = (settings && settings.fontSize) || 100;
      rendition.themes.default(Object.assign({ body: { 'padding': '0 10px !important' } }, KNOWN_STYLE));
      Object.keys(THEMES).forEach(function (name) {
        rendition.themes.register(name, Object.assign({}, THEMES[name], KNOWN_STYLE));
      });
      setKnownList(settings && settings.known);
      window.__setTheme((settings && settings.theme) || 'light');
      rendition.themes.fontSize(fs + '%');
      rendition.hooks.content.register(attach);
      rendition.on('relocated', function (loc) {
        post({ type: 'relocated', cfi: loc.start.cfi, percent: loc.start.percentage || 0 });
      });
      rendition.on('rendered', function (section, view) {
        var v = document.getElementById('viewer');
        var info = 'rendered ' + (section && section.href) + ' viewer=' + v.clientWidth + 'x' + v.clientHeight + ' iframes=' + document.querySelectorAll('iframe').length;
        try {
          var f = document.querySelector('iframe');
          var r = f.getBoundingClientRect();
          var cs = getComputedStyle(f);
          var wrap = f.parentElement; var wr = wrap.getBoundingClientRect();
          var doc = f.contentDocument;
          var body = doc && doc.body;
          var bcs = body && doc.defaultView.getComputedStyle(body);
          info += ' | iframe rect=' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
            + ' vis=' + cs.visibility + ' op=' + cs.opacity + ' disp=' + cs.display
            + ' | wrap=' + Math.round(wr.x) + ',' + Math.round(wr.y) + ' ' + Math.round(wr.width) + 'x' + Math.round(wr.height) + ' wrapVis=' + getComputedStyle(wrap).visibility
            + ' | body text=' + (body ? (body.innerText || '').trim().length : -1) + ' color=' + (bcs && bcs.color) + ' bg=' + (bcs && bcs.backgroundColor)
            + ' bodyW=' + (body && body.scrollWidth) + ' cols=' + (bcs && bcs.columnWidth) + ' | container scrollLeft=' + (v.firstElementChild && v.firstElementChild.scrollLeft);
        } catch (e) { info += ' | diag error: ' + e; }
        post({ type: 'debug', msg: info });
      });
      rendition.on('displayError', function (e) { post({ type: 'error', message: 'displayError: ' + String(e) }); });
      book.opened.then(function () { post({ type: 'debug', msg: 'opened, spine=' + (book.spine && book.spine.length) }); })
        .catch(function (e) { post({ type: 'error', message: 'open failed: ' + String(e) }); });
      book.ready
        .then(function () {
          // Книга с DRM: в архиве лежит META-INF/encryption.xml — текст зашифрован, читать нечего.
          var zip = book.archive && book.archive.zip;
          if (zip && zip.file('META-INF/encryption.xml')) {
            post({ type: 'error', code: 'drm', message: 'DRM' });
            throw new Error('drm');
          }
          return book.locations.generate(1200);
        })
        .then(function () {
          var meta = book.packaging && book.packaging.metadata;
          post({ type: 'ready', title: (meta && meta.title) || '', author: (meta && meta.creator) || '' });
        })
        .catch(function (e) { if (String(e).indexOf('drm') < 0) post({ type: 'error', message: String(e) }); });
      rendition.display(cfi || undefined)
        .then(function () { post({ type: 'debug', msg: 'displayed' }); })
        .catch(function (e) { post({ type: 'error', message: 'display: ' + String(e) }); });
    } catch (e) {
      post({ type: 'error', message: String(e) });
    }
  };
  window.__next = function () { if (rendition) rendition.next(); };
  window.__prev = function () { if (rendition) rendition.prev(); };
  window.__setFontSize = function (p) { if (rendition) rendition.themes.fontSize(p + '%'); };
  window.__setTheme = function (name) {
    var t = THEMES[name] || THEMES.light;
    document.body.style.background = t.body.background;
    if (rendition) rendition.themes.select(THEMES[name] ? name : 'light');
  };
  window.__setKnown = function (list) {
    setKnownList(list);
    if (!rendition) return;
    rendition.getContents().forEach(function (c) { unhighlight(c.document); highlightKnown(c.document); });
  };

  post({ type: 'loaded' });
})();
</script>
</body>
</html>`;
