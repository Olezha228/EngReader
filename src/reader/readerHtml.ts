// HTML-страница читалки для WebView: epub.js + мост тапа по слову.
// Сообщения в RN (postMessage, JSON):
//   {type:'loaded'}                         — страница готова принимать __openBook
//   {type:'ready', title}                   — книга распакована, locations посчитаны
//   {type:'relocated', cfi, percent}        — позиция чтения
//   {type:'tap'}                            — одиночный тап по центру: показать/скрыть панель прогресса
//   {type:'toc', items:[{label, href, depth}]} — оглавление книги
//   {type:'selection', text, words}         — текущее выделение (пусто — снято); перевод по __translateSelection()
//   {type:'word', word, sentence, prev, next, cfi, selection?} — ДВОЙНОЙ тап по слову или выделенная фраза (≤ 5 слов)
//   {type:'too_long', words}                — выделено больше 5 слов
//   {type:'miss'}                           — тап не по тексту
//   {type:'error', message, code?}          — code 'drm' — книга зашифрована
// Команды из RN: window.__openBook(base64, cfi, {fontSize, theme, known}), __next(), __prev(),
//   __setFontSize(percent), __setTheme('light'|'sepia'|'dark'), __setKnown(string[]), __goTo(href), __goPercent(0..1)
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
  // Выученные слова — жёлтый фон; ссылки книги не меняют цвет при касании (иначе сноски вспыхивают красным).
  var KNOWN_STYLE = {
    'mark.er-known': { background: 'rgba(255, 214, 0, 0.45)', color: 'inherit', 'border-radius': '3px', padding: '0 1px', 'box-decoration-break': 'clone', '-webkit-box-decoration-break': 'clone' },
    'a, a:link, a:visited, a:active, a:hover, a:focus': { color: 'inherit !important', 'text-decoration': 'none !important', outline: 'none !important' },
    '*': { '-webkit-tap-highlight-color': 'transparent' },
    '::selection': { background: 'rgba(47, 111, 237, 0.28)' }
  };
  var knownRe = null;

  function escRe(s) { return s.replace(/[.*+?^$\\{\\}()|\\[\\]\\\\]/g, '\\\\$&'); }
  var PARTICLES = { out: 1, off: 1, up: 1, down: 1, in: 1, on: 1, away: 1, back: 1, over: 1, apart: 1, aside: 1, along: 1, around: 1, through: 1 };
  function setKnownList(list) {
    list = (list || []).filter(function (w) { return w && /^[A-Za-z][A-Za-z'\\u2019-]*( [A-Za-z'\\u2019-]+){0,3}$/.test(w); }).slice(0, 3000);
    list.sort(function (a, b) { return b.length - a.length; }); // фразы раньше одиночных слов
    var parts = list.map(function (w) {
      var ws = w.split(' ');
      // Разделяемый фразовый глагол: «take out» должен подсветить и «took a watch out» (до 3 слов между).
      if (ws.length === 2 && PARTICLES[ws[1]]) return escRe(ws[0]) + "(?:\\\\s+[A-Za-z'\\u2019-]+){0,3}\\\\s+" + escRe(ws[1]);
      return escRe(w);
    });
    knownRe = parts.length ? new RegExp('\\\\b(' + parts.join('|') + ')\\\\b', 'gi') : null;
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

  // Выделение пальцем (долгое нажатие + ручки). Пока оно есть, RN показывает кнопку «Перевести: …»;
  // карточка открывается только по ней (__translateSelection), а не сама по таймеру.
  var selTimer = null, lastSelection = '', selContents = null;
  function snappedRange(doc) {
    var sel = doc.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0).cloneRange();
    // Ручки часто останавливаются посреди слова — раздвигаем копию диапазона до границ слов.
    try {
      var sc = range.startContainer, ec = range.endContainer;
      if (sc.nodeType === 3) range.setStart(sc, expandWord(sc.textContent || '', range.startOffset).start);
      if (ec.nodeType === 3) range.setEnd(ec, expandWord(ec.textContent || '', Math.max(0, range.endOffset - 1)).end);
    } catch (e) {}
    return range;
  }
  function watchSelection(contents) {
    var doc = contents.document;
    try { doc.body.style.webkitTouchCallout = 'none'; } catch (e) {}
    doc.addEventListener('selectionchange', function () {
      if (selTimer) clearTimeout(selTimer);
      selTimer = setTimeout(function () {
        var range = snappedRange(doc);
        var text = range ? range.toString().replace(/\\s+/g, ' ').trim() : '';
        if (text === lastSelection) return;
        lastSelection = text;
        selContents = text ? contents : null;
        post({ type: 'selection', text: text, words: text ? text.split(' ').filter(Boolean).length : 0 });
      }, 250);
    });
  }
  window.__translateSelection = function () {
    var contents = selContents;
    if (!contents) return;
    var doc = contents.document;
    var range = snappedRange(doc);
    if (!range) return;
    var text = range.toString().replace(/\\s+/g, ' ').trim();
    var words = text.split(' ').filter(Boolean);
    if (words.length > 5) { post({ type: 'too_long', words: words.length }); return; }
    var cfi = '';
    try { cfi = contents.cfiFromRange(range); } catch (e) {}
    var node = range.startContainer.nodeType === 3 ? range.startContainer : range.startContainer.firstChild || range.startContainer;
    var ctx = contextAt(blockOf(node), node, range.startOffset, text.length);
    post({ type: 'word', word: text, sentence: ctx.sentence, prev: '', next: '', cfi: cfi, selection: true });
  };

  var lastTap = null, singleTapTimer = null;

  function frameOf(doc) {
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) { try { if (frames[i].contentDocument === doc) return frames[i]; } catch (e) {} }
    return frames[0] || null;
  }

  // Вешаем жесты на документ каждой главы (iframe epub.js).
  function attach(contents) {
    var doc = contents.document;
    var start = null;
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
      var isTap = dt < 500 && Math.abs(dx) < 12 && Math.abs(dy) < 12;
      var sel = doc.getSelection();
      if (sel && !sel.isCollapsed) {
        // Есть выделение фразы: свайп/движение — не трогаем (идёт работа с ручками); короткий тап снимает его.
        if (!isTap) return;
        sel.removeAllRanges();
        lastSelection = '';
      }
      if (Math.abs(dx) > 60 && Math.abs(dy) < 80) { if (dx < 0) rendition.next(); else rendition.prev(); return; }
      if (isTap) {
        // Документ главы в paginated-режиме шириной во все её страницы, поэтому края считаем
        // в ЭКРАННЫХ координатах: позиция iframe на экране + позиция тапа внутри него.
        var ifr = frameOf(doc);
        var left = ifr ? ifr.getBoundingClientRect().left : 0;
        var sx = left + t.clientX;
        var W = window.innerWidth || document.documentElement.clientWidth;
        if (sx < W * 0.1) { rendition.prev(); return; }
        if (sx > W * 0.9) { rendition.next(); return; }
        // Диагностика «красного текста»: цвет под пальцем и у тела главы, элемент и его классы.
        try {
          var el = doc.elementFromPoint(t.clientX, t.clientY);
          var chain = [], cur = el, n = 0;
          while (cur && cur.nodeType === 1 && n++ < 4) {
            var cs = doc.defaultView.getComputedStyle(cur);
            chain.push(cur.tagName + (cur.className ? '.' + String(cur.className).replace(/\\s+/g, '.') : '') + '[' + cs.color + (cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? ' fill=' + cs.webkitTextFillColor : '') + ']');
            cur = cur.parentElement;
          }
          post({ type: 'debug', msg: 'colors: body=' + doc.defaultView.getComputedStyle(doc.body).color + ' | ' + chain.join(' < ') + ' | sel=' + (doc.getSelection() && doc.getSelection().toString().slice(0, 20)) });
        } catch (e) {}
        // Двойной тап — слово; одиночный (после паузы) — панель прогресса и оглавления.
        var now = Date.now();
        if (lastTap && now - lastTap.t < 320 && Math.abs(t.clientX - lastTap.x) < 40 && Math.abs(t.clientY - lastTap.y) < 40) {
          if (singleTapTimer) clearTimeout(singleTapTimer);
          singleTapTimer = null;
          lastTap = null;
          handleTap(contents, t.clientX, t.clientY);
          return;
        }
        lastTap = { t: now, x: t.clientX, y: t.clientY };
        if (singleTapTimer) clearTimeout(singleTapTimer);
        singleTapTimer = setTimeout(function () { singleTapTimer = null; lastTap = null; post({ type: 'tap' }); }, 320);
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
        post({ type: 'relocated', cfi: loc.start.cfi, percent: loc.start.percentage || 0, href: loc.start.href || '' });
      });
      book.loaded.navigation.then(function (nav) {
        var items = [];
        (function walk(list, depth) {
          (list || []).forEach(function (it) {
            items.push({ label: String(it.label || '').replace(/\\s+/g, ' ').trim(), href: it.href, depth: depth });
            if (it.subitems && it.subitems.length) walk(it.subitems, depth + 1);
          });
        })(nav.toc || [], 0);
        post({ type: 'toc', items: items });
      }).catch(function () {});
      rendition.on('rendered', function (section) {
        var f = document.querySelector('iframe');
        var body = f && f.contentDocument && f.contentDocument.body;
        post({ type: 'debug', msg: 'rendered ' + (section && section.href) + ' text=' + (body ? (body.innerText || '').trim().length : -1) });
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
  window.__goTo = function (href) { if (rendition) rendition.display(href).catch(function (e) { post({ type: 'error', message: 'goTo: ' + e }); }); };
  window.__goPercent = function (p) {
    if (!book || !rendition) return;
    var cfi = book.locations.cfiFromPercentage(Math.min(1, Math.max(0, p)));
    if (cfi) rendition.display(cfi);
  };
  window.__setFontSize = function (p) { if (rendition) rendition.themes.fontSize(p + '%'); };
  window.__setTheme = function (name) {
    var t = THEMES[name] || THEMES.light;
    document.body.style.background = t.body.background;
    if (rendition) rendition.themes.select(THEMES[name] ? name : 'light');
  };
  window.__clearSelection = function () {
    lastSelection = '';
    selContents = null;
    post({ type: 'selection', text: '', words: 0 });
    if (!rendition) return;
    rendition.getContents().forEach(function (c) {
      try { var s = c.window.getSelection(); if (s) s.removeAllRanges(); } catch (e) {}
    });
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
