// Упаковывает epub.js и JSZip в TS-модуль, чтобы читалка работала офлайн внутри WebView.
// Запуск: node scripts/gen-vendor.mjs  (результат коммитится: src/reader/vendor.generated.ts)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const jszip = read('assets/vendor/jszip.min.js');
const epubjs = read('assets/vendor/epub.min.js');

// JSON.stringify экранирует всё, что могло бы закрыть <script> или шаблонную строку.
const safe = (s) => JSON.stringify(s).replace(/<\/script/gi, '<\\/script');

const out = `// СГЕНЕРИРОВАНО scripts/gen-vendor.mjs — не править руками.
// JSZip 3.10.1 (MIT) и epub.js 0.3.93 (BSD-2-Clause) как строки для WebView.
export const JSZIP: string = ${safe(jszip)};
export const EPUBJS: string = ${safe(epubjs)};
`;

mkdirSync(join(root, 'src/reader'), { recursive: true });
writeFileSync(join(root, 'src/reader/vendor.generated.ts'), out);
console.log('vendor.generated.ts:', (jszip.length + epubjs.length / 1024).toFixed(0), 'KiB of JS embedded');
