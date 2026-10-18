// Metro: отдаём EPUB-файлы как ассеты (тестовая книга в assets/books).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('epub');

module.exports = config;
