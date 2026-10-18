// Корень приложения: БД с миграциями + простая навигация по трём экранам.
// Expo Router подключим на этапе разрастания экранов (T-3.3), для скелета хватает состояния.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { migrate } from './src/db/schema';
import type { Book } from './src/lib/books';
import { AboutScreen } from './src/screens/AboutScreen';
import { CardsScreen } from './src/screens/CardsScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';
import { VocabScreen } from './src/screens/VocabScreen';

type Route =
  | { name: 'library' } | { name: 'reader'; book: Book } | { name: 'vocab' } | { name: 'cards' } | { name: 'about' };

function Root() {
  const db = useSQLiteContext();
  const [route, setRoute] = useState<Route>({ name: 'library' });
  const [vocabCount, setVocabCount] = useState(0);

  const refreshCount = useCallback(async () => {
    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM vocab');
    setVocabCount(row?.n ?? 0);
  }, [db]);

  useEffect(() => { void refreshCount(); }, [refreshCount, route]);

  switch (route.name) {
    case 'reader':
      return <ReaderScreen book={route.book} onBack={() => setRoute({ name: 'library' })} />;
    case 'vocab':
      return <VocabScreen onBack={() => setRoute({ name: 'library' })} onChanged={refreshCount} />;
    case 'cards':
      return <CardsScreen onBack={() => setRoute({ name: 'library' })} />;
    case 'about':
      return <AboutScreen onBack={() => setRoute({ name: 'library' })} />;
    default:
      return (
        <LibraryScreen
          vocabCount={vocabCount}
          onOpen={(book) => setRoute({ name: 'reader', book })}
          onVocab={() => setRoute({ name: 'vocab' })}
          onCards={() => setRoute({ name: 'cards' })}
          onAbout={() => setRoute({ name: 'about' })}
        />
      );
  }
}

function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
      <Text style={styles.muted}>Готовим словарь…</Text>
    </View>
  );
}

export default function App() {
  return (
    <>
      <StatusBar style="dark" />
      <SQLiteProvider databaseName="engreader.db" onInit={migrate} useSuspense={false}>
        <RootWithFallback />
      </SQLiteProvider>
    </>
  );
}

// SQLiteProvider без Suspense рендерит детей сразу после инициализации; до неё показываем загрузку.
function RootWithFallback() {
  const [ready, setReady] = useState(false);
  const db = useSQLiteContext();
  useEffect(() => {
    db.getFirstAsync('PRAGMA user_version').then(() => setReady(true)).catch(() => setReady(true));
  }, [db]);
  return ready ? <Root /> : <Loading />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#fff' },
  muted: { color: '#666' },
});
