// «О приложении»: что это, где данные, атрибуция источников (лицензии требуют её показывать).
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { BUNDLED_DICT_VERSION } from '../db/dictionary';

type Props = { onBack: () => void };

const LINKS = [
  { title: 'Wiktionary (через kaikki.org)', note: 'словарь EN→RU, транскрипции, формы слов — CC BY-SA 3.0', url: 'https://kaikki.org/dictionary/English/' },
  { title: 'Tatoeba', note: 'примеры предложений с переводом — CC BY 2.0 FR, автор указан под каждым примером', url: 'https://tatoeba.org/' },
  { title: 'Reverso Context', note: 'открывается как веб-страница по кнопке в карточке слова', url: 'https://context.reverso.net/' },
  { title: 'epub.js', note: 'отрисовка EPUB — BSD-2-Clause', url: 'https://github.com/futurepress/epub.js' },
  { title: 'ts-fsrs', note: 'алгоритм интервального повторения FSRS — MIT', url: 'https://github.com/open-spaced-repetition/ts-fsrs' },
  { title: 'Project Gutenberg', note: 'тестовая книга «Alice’s Adventures in Wonderland» — public domain', url: 'https://www.gutenberg.org/ebooks/11' },
];

export function AboutScreen({ onBack }: Props) {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Библиотека</Text></Pressable>
        <Text style={styles.h1}>О приложении</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.p}>
          EngReader — читалка английских книг с переводом слова по тапу, личным словарём и карточками
          для запоминания. Все данные хранятся только на этом телефоне: без учётной записи и сервера.
          Сеть нужна лишь для примеров употребления.
        </Text>
        <Text style={styles.p}>
          Чтобы не потерять словарь при смене устройства, время от времени делайте «Экспорт» в разделе «Словарь».
        </Text>
        <Text style={styles.h2}>Источники и лицензии</Text>
        {LINKS.map((l) => (
          <Pressable key={l.url} style={styles.link} onPress={() => WebBrowser.openBrowserAsync(l.url)}>
            <Text style={styles.linkTitle}>{l.title} ↗</Text>
            <Text style={styles.linkNote}>{l.note}</Text>
          </Pressable>
        ))}
        <Text style={styles.muted}>Версия словаря: {BUNDLED_DICT_VERSION}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  back: { color: '#2f6fed', fontSize: 16 },
  h1: { fontSize: 22, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  p: { fontSize: 16, lineHeight: 23, color: '#222' },
  h2: { fontSize: 18, fontWeight: '700', marginTop: 8 },
  link: { gap: 2, paddingVertical: 6 },
  linkTitle: { fontSize: 16, color: '#2f6fed', fontWeight: '600' },
  linkNote: { color: '#555', fontSize: 14 },
  muted: { color: '#999', fontSize: 12, marginTop: 16 },
});
