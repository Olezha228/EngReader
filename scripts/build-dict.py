#!/usr/bin/env python3
"""Сборка офлайн-словаря EN→RU из выгрузки Wiktionary (kaikki.org) в SQLite.

Вход:  kaikki.org-dictionary-English.jsonl(.gz) — одна статья в строке.
Выход: assets/dict/dict.db с таблицами dict_entries / dict_senses / dict_forms / dict_phrasals / dict_meta
       (та же схема, что в src/db/schema.ts; на устройстве файл подключается ATTACH).

Запуск:  python3 -I scripts/build-dict.py <путь к .jsonl.gz> [assets/dict/dict.db]
Данные Wiktionary — CC BY-SA 3.0; атрибуция обязательна в приложении (экран «О приложении»).
"""
from __future__ import annotations

import gzip
import io
import json
import os
import re
import sqlite3
import sys
import time

MAX_SENSES = 8
MAX_PHRASE_WORDS = 3
WORD_RE = re.compile(r"^[a-z][a-z'\-]*$")
PHRASE_RE = re.compile(r"^[a-z][a-z'\-]*( [a-z][a-z'\-]*){1,2}$")
SKIP_TAGS = {"obsolete", "archaic", "misspelling", "alternative", "alt-of", "form-of", "romanization"}
# Формы, которые НЕ надо класть в таблицу форм (альтернативные написания и т.п.).
SKIP_FORM_TAGS = {"alternative", "romanization", "canonical", "table-tags", "inflection-template", "class"}
POS_MAP = {
    "noun": "n", "verb": "v", "adj": "adj", "adv": "adv", "pron": "pron", "prep": "prep",
    "conj": "conj", "det": "det", "num": "num", "intj": "intj", "name": "name", "particle": "part",
    "phrase": "phr", "prep_phrase": "phr", "proverb": "phr",
}


def open_dump(path: str) -> io.TextIOBase:
    if path.endswith(".gz"):
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8", errors="replace")
    return open(path, "r", encoding="utf-8", errors="replace")


def pick_ipa(entry: dict) -> str | None:
    us = None
    first = None
    for s in entry.get("sounds") or []:
        ipa = s.get("ipa")
        if not ipa:
            continue
        ipa = ipa.strip("/[]")
        if first is None:
            first = ipa
        tags = s.get("tags") or []
        if us is None and any(t in ("US", "General-American", "GA") for t in tags):
            us = ipa
    return us or first


def russian_translations(entry: dict) -> list[str]:
    """Русские переводы в порядке смыслов, без дублей. Берём и верхний уровень, и senses[].translations."""
    out: list[str] = []
    seen: set[str] = set()

    def take(tr_list):
        for t in tr_list or []:
            if t.get("code") != "ru" and t.get("lang") != "Russian":
                continue
            w = (t.get("word") or "").strip()
            # Хвосты вроде «бро́сить pf the habit» — пометки вида из Wiktionary, не часть перевода.
            w = re.sub(r"\s+(pf|impf)\b.*$", "", w).strip()
            if not w or len(w) > 60 or re.search(r"[A-Za-z]", w):
                continue
            key = w.lower().replace("́", "")  # ударение не делает слово другим
            if key in seen:
                continue
            seen.add(key)
            out.append(w)

    for sense in entry.get("senses") or []:
        tags = set(sense.get("tags") or [])
        if tags & SKIP_TAGS:
            continue
        take(sense.get("translations"))
    take(entry.get("translations"))
    return out[:MAX_SENSES]


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "assets", "dict", "dict.db")
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    if os.path.exists(dst):
        os.remove(dst)

    db = sqlite3.connect(dst)
    db.executescript(
        """
        PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA page_size = 4096;
        CREATE TABLE dict_entries (id INTEGER PRIMARY KEY NOT NULL, lemma TEXT NOT NULL, pos TEXT NOT NULL, ipa TEXT, freq_rank INTEGER);
        CREATE TABLE dict_senses (entry_id INTEGER NOT NULL, ord INTEGER NOT NULL, ru TEXT NOT NULL);
        CREATE TABLE dict_forms (form TEXT PRIMARY KEY NOT NULL, entry_id INTEGER NOT NULL) WITHOUT ROWID;
        CREATE TABLE dict_phrasals (phrase TEXT PRIMARY KEY NOT NULL, entry_id INTEGER NOT NULL) WITHOUT ROWID;
        CREATE TABLE dict_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        """
    )

    t0 = time.time()
    lines = entries = phrases = forms_n = skipped_no_ru = 0
    next_id = 1
    forms_buf: list[tuple[str, int]] = []
    entries_buf: list[tuple[int, str, str, str | None]] = []
    senses_buf: list[tuple[int, int, str]] = []
    phrases_buf: list[tuple[str, int]] = []

    def flush():
        db.executemany("INSERT INTO dict_entries (id, lemma, pos, ipa) VALUES (?, ?, ?, ?)", entries_buf)
        db.executemany("INSERT INTO dict_senses (entry_id, ord, ru) VALUES (?, ?, ?)", senses_buf)
        db.executemany("INSERT OR IGNORE INTO dict_forms (form, entry_id) VALUES (?, ?)", forms_buf)
        db.executemany("INSERT OR IGNORE INTO dict_phrasals (phrase, entry_id) VALUES (?, ?)", phrases_buf)
        entries_buf.clear(); senses_buf.clear(); forms_buf.clear(); phrases_buf.clear()

    with open_dump(src) as f:
        for line in f:
            lines += 1
            if lines % 100000 == 0:
                flush()
                print(f"  {lines:>9} строк · {entries} статей · {time.time() - t0:5.0f} с", file=sys.stderr, flush=True)
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("lang_code") != "en":
                continue
            word = (e.get("word") or "").strip()
            lw = word.lower()
            pos_raw = e.get("pos") or ""
            pos = POS_MAP.get(pos_raw)
            if not pos:
                continue
            is_word = bool(WORD_RE.match(lw))
            is_phrase = (not is_word) and bool(PHRASE_RE.match(lw)) and len(lw.split()) <= MAX_PHRASE_WORDS
            if not (is_word or is_phrase):
                # Имена собственные с заглавной (London) — отдельная проверка ниже.
                if not (pos == "name" and re.match(r"^[A-Z][a-z'\-]+$", word)):
                    continue
            ru = russian_translations(e)
            if not ru:
                skipped_no_ru += 1
                continue
            eid = next_id
            next_id += 1
            entries += 1
            entries_buf.append((eid, lw if pos != "name" else word, "phr v" if (is_phrase and pos == "v") else pos, pick_ipa(e)))
            for i, r in enumerate(ru):
                senses_buf.append((eid, i, r))
            if is_phrase:
                phrases += 1
                phrases_buf.append((lw, eid))
            for fm in e.get("forms") or []:
                form = (fm.get("form") or "").strip().lower()
                tags = set(fm.get("tags") or [])
                if not form or form == lw or tags & SKIP_FORM_TAGS or not WORD_RE.match(form):
                    continue
                forms_buf.append((form, eid))
                forms_n += 1
    flush()

    db.executescript(
        """
        CREATE INDEX idx_dict_entries_lemma ON dict_entries(lemma);
        CREATE INDEX idx_dict_senses_entry ON dict_senses(entry_id);
        """
    )
    db.execute("INSERT INTO dict_meta (key, value) VALUES ('source', 'Wiktionary via kaikki.org, CC BY-SA 3.0')")
    db.execute("INSERT INTO dict_meta (key, value) VALUES ('built_at', ?)", (time.strftime("%Y-%m-%d"),))
    db.execute("INSERT INTO dict_meta (key, value) VALUES ('version', ?)", (time.strftime("%Y%m%d"),))
    db.commit()
    db.execute("VACUUM")
    db.close()

    size_mb = os.path.getsize(dst) / 1e6
    print(
        f"Готово за {time.time() - t0:.0f} с: {entries} статей, {phrases} фраз, {forms_n} форм; "
        f"без русского перевода пропущено {skipped_no_ru}. Файл {dst}: {size_mb:.1f} МБ",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
