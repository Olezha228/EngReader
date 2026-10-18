#!/usr/bin/env python3
"""Иконки приложения без внешних зависимостей (чистый Python, свой PNG-энкодер).

Рисует плоскую иконку: синий фон, белая страница с строками текста и подчёркнутым словом.
Запуск: python3 -I scripts/gen-icons.py   → assets/icon.png, splash-icon.png, android-icon-*.png, favicon.png
Это заглушка на время разработки; дизайнерскую иконку положить теми же именами.
"""
from __future__ import annotations

import os
import struct
import sys
import zlib

BLUE = (0x2F, 0x6F, 0xED, 255)
WHITE = (255, 255, 255, 255)
LINE = (0x9F, 0xB8, 0xF5, 255)
ACCENT = (0xFF, 0xC8, 0x3D, 255)
CLEAR = (0, 0, 0, 0)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")


def png(path: str, size: int, pixel) -> None:
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            row.extend(pixel(x, y))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(data)


def rounded_rect(x: float, y: float, x0: float, y0: float, x1: float, y1: float, r: float) -> bool:
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def glyph(x: float, y: float, s: float, bg):
    """Страница с текстом в квадрате s×s; bg — цвет фона или None (прозрачно)."""
    u = s / 1024.0
    # Страница
    if rounded_rect(x, y, 262 * u, 180 * u, 762 * u, 844 * u, 56 * u):
        # Загнутый уголок
        if x > 650 * u and y < 292 * u and (x - 650 * u) + (292 * u - y) > 112 * u:
            return bg if bg else CLEAR
        # Строки текста
        for i, (lx0, lx1) in enumerate([(340, 640), (340, 684), (340, 600), (340, 684), (340, 560)]):
            ly = (330 + i * 92) * u
            if lx0 * u <= x <= lx1 * u and ly <= y <= ly + 34 * u:
                return LINE
        # Подчёркнутое слово — «тап по слову»
        if 340 * u <= x <= 520 * u and 712 * u <= y <= 746 * u:
            return BLUE
        if 340 * u <= x <= 520 * u and 756 * u <= y <= 774 * u:
            return ACCENT
        return WHITE
    return bg if bg else CLEAR


def main() -> int:
    os.makedirs(ROOT, exist_ok=True)
    out = []

    def write(name: str, size: int, fn):
        path = os.path.join(ROOT, name)
        png(path, size, fn)
        out.append(f"{name} ({size}px)")

    write("icon.png", 1024, lambda x, y: glyph(x, y, 1024, BLUE))
    write("splash-icon.png", 1024, lambda x, y: glyph(x, y, 1024, None))
    write("android-icon-foreground.png", 1024, lambda x, y: glyph((x - 128) * 1024 / 768, (y - 128) * 1024 / 768, 1024, None))
    write("android-icon-background.png", 1024, lambda x, y: BLUE)
    write("android-icon-monochrome.png", 1024, lambda x, y: WHITE if glyph((x - 128) * 1024 / 768, (y - 128) * 1024 / 768, 1024, None) != CLEAR else CLEAR)
    write("favicon.png", 48, lambda x, y: glyph(x, y, 48, BLUE))
    print("Сгенерировано:", ", ".join(out), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
