// Экран «Карточки»: сводка дня → сессия (пропуск в контексте → оборот → оценка с предсказанным сроком).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import { useSQLiteContext } from 'expo-sqlite';
import {
  blankOut, getQueue, getStats, previewIntervals, rateCard, Rating,
  type Grade, type Queue, type QueueItem, type Stats,
} from '../lib/srs';

type Props = { onBack: () => void };

const GRADES: { grade: Grade; label: string; color: string }[] = [
  { grade: Rating.Again, label: 'Не помню', color: '#d9534f' },
  { grade: Rating.Hard, label: 'Трудно', color: '#e0a030' },
  { grade: Rating.Good, label: 'Помню', color: '#2f6fed' },
  { grade: Rating.Easy, label: 'Легко', color: '#3a9d5d' },
];

export function CardsScreen({ onBack }: Props) {
  const db = useSQLiteContext();
  const [stats, setStats] = useState<Stats | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [session, setSession] = useState<'summary' | 'study' | 'done'>('summary');
  const [done, setDone] = useState(0);
  const [leechNote, setLeechNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, q] = await Promise.all([getStats(db), getQueue(db)]);
    setStats(s);
    setQueue(q);
  }, [db]);

  useEffect(() => { void load(); }, [load]);

  const current: QueueItem | undefined = queue?.items[index];
  const intervals = useMemo(() => (current ? previewIntervals(current) : null), [current]);
  const front = useMemo(() => {
    if (!current) return null;
    const sentence = current.sentence ?? '';
    return sentence ? blankOut(sentence, current.form ?? current.lemma, current.lemma) : { text: '', blanked: false };
  }, [current]);
  const translations = useMemo(
    () => (current ? (JSON.parse(current.translations_json) as string[]) : []),
    [current],
  );

  const speak = (text: string) => Speech.speak(text, { language: 'en-US', rate: 0.95 });

  const onGrade = async (grade: Grade) => {
    if (!current || !queue) return;
    const res = await rateCard(db, current, grade);
    setLeechNote(res.becameLeech ? `«${current.lemma}» помечено сложным: добавьте свой пример или подсказку в словаре` : null);
    setDone((n) => n + 1);
    setRevealed(false);
    // Карточка в обучении (1 мин / 10 мин) возвращается в хвост очереди этой же сессии.
    const dueSoon = res.next.due - Date.now() < 30 * 60 * 1000;
    const rest = queue.items.slice(index + 1);
    const items = dueSoon ? [...rest, { ...current, ...res.next }] : rest;
    if (items.length === 0) {
      setSession('done');
      await load();
      return;
    }
    setQueue({ ...queue, items });
    setIndex(0);
  };

  if (!stats || !queue) {
    return <SafeAreaView style={styles.root}><ActivityIndicator style={{ marginTop: 40 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Библиотека</Text></Pressable>
        <Text style={styles.h1}>Карточки</Text>
        <Text style={styles.counter}>{session === 'study' ? `${done} · осталось ${queue.items.length - index}` : ''}</Text>
      </View>

      {session === 'summary' ? (
        <View style={styles.center}>
          <Text style={styles.big}>На сегодня</Text>
          <Text style={styles.line}>{queue.newCount} новых · {queue.dueCount} к повторению</Text>
          <Text style={styles.muted}>всего карточек {stats.total} · сегодня повторено {stats.reviewedToday}{stats.leeches ? ` · сложных ${stats.leeches}` : ''}</Text>
          {queue.items.length > 0 ? (
            <Pressable style={styles.primary} onPress={() => { setIndex(0); setDone(0); setSession('study'); }}>
              <Text style={styles.primaryText}>Начать</Text>
            </Pressable>
          ) : (
            <Text style={styles.muted}>Очередь пуста. Добавляйте слова из книги — они появятся здесь.</Text>
          )}
          <Text style={styles.hintSmall}>лимит новых в день: {queue.newLimit}</Text>
        </View>
      ) : null}

      {session === 'study' && current && front ? (
        <ScrollView contentContainerStyle={styles.card}>
          <Text style={styles.stateTag}>
            {current.state === 0 ? 'новое' : current.state === 2 ? 'повторение' : 'учим'}{current.is_leech ? ' · сложное' : ''}
          </Text>
          {front.text ? (
            <Text style={styles.sentence}>{front.text}</Text>
          ) : (
            <Text style={styles.sentence}>{current.lemma}</Text>
          )}
          {!revealed ? (
            <>
              <Text style={styles.hint}>
                {front.blanked ? `${current.pos ? current.pos + ' · ' : ''}${translations[0] ?? 'вспомните слово'}` : 'Что это слово значит?'}
              </Text>
              <Pressable style={styles.primary} onPress={() => { setRevealed(true); speak(current.lemma); }}>
                <Text style={styles.primaryText}>Показать ответ</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.answer}>
                <Pressable onPress={() => speak(current.lemma)}>
                  <Text style={styles.lemma}>{current.lemma} <Text style={styles.speaker}>🔊</Text></Text>
                </Pressable>
                {current.ipa ? <Text style={styles.ipa}>/{current.ipa}/</Text> : null}
                {translations.length === 0 ? <Text style={styles.muted}>перевод не задан</Text> : null}
                {translations.slice(0, 4).map((t, i) => <Text key={i} style={styles.tr}>{i + 1}. {t}</Text>)}
                {current.sentence ? (
                  <Pressable onPress={() => speak(current.sentence ?? '')}>
                    <Text style={styles.context}>« {current.sentence} »</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.grades}>
                {GRADES.map((g) => (
                  <Pressable key={g.grade} style={[styles.gradeBtn, { backgroundColor: g.color }]} onPress={() => onGrade(g.grade)}>
                    <Text style={styles.gradeLabel}>{g.label}</Text>
                    <Text style={styles.gradeInterval}>{intervals?.[g.grade]}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {leechNote ? <Text style={styles.leech}>{leechNote}</Text> : null}
        </ScrollView>
      ) : null}

      {session === 'done' ? (
        <View style={styles.center}>
          <Text style={styles.big}>На сегодня всё</Text>
          <Text style={styles.line}>повторено {done}</Text>
          <Pressable style={styles.primary} onPress={() => { setSession('summary'); void load(); }}>
            <Text style={styles.primaryText}>К сводке</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  back: { color: '#2f6fed', fontSize: 16 },
  h1: { fontSize: 22, fontWeight: '700', flex: 1 },
  counter: { color: '#888', fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  big: { fontSize: 24, fontWeight: '700' },
  line: { fontSize: 17 },
  muted: { color: '#777', textAlign: 'center' },
  hintSmall: { color: '#aaa', fontSize: 12, marginTop: 12 },
  primary: { backgroundColor: '#2f6fed', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, marginTop: 8 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16, textAlign: 'center' },
  card: { padding: 20, gap: 16 },
  stateTag: { color: '#999', fontSize: 12, textTransform: 'uppercase' },
  sentence: { fontSize: 22, lineHeight: 32 },
  hint: { color: '#666', fontSize: 15 },
  answer: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#eee' },
  lemma: { fontSize: 28, fontWeight: '700' },
  speaker: { fontSize: 18 },
  ipa: { color: '#555', fontSize: 16 },
  tr: { fontSize: 17 },
  context: { color: '#444', fontStyle: 'italic', marginTop: 6, lineHeight: 22 },
  grades: { flexDirection: 'row', gap: 8, marginTop: 8 },
  gradeBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  gradeLabel: { color: '#fff', fontWeight: '700' },
  gradeInterval: { color: '#fff', opacity: 0.85, fontSize: 12, marginTop: 2 },
  leech: { color: '#a33', marginTop: 8 },
});
