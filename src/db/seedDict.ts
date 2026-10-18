// Посевной словарь скелета: ~90 частотных слов и фразовых глаголов, достаточно для демо на «Алисе».
// Полный словарь (Wiktionary → dict.sqlite, ~100 тыс. статей) — задача T-2.1; эта таблица тогда заменяется.
import type { SQLiteDatabase } from 'expo-sqlite';

type Seed = { lemma: string; pos: string; ipa?: string; ru: string[]; forms?: string[]; phrase?: boolean };

const SEED: Seed[] = [
  { lemma: 'be', pos: 'v', ipa: 'biː', ru: ['быть', 'являться', 'находиться'], forms: ['am', 'is', 'are', 'was', 'were', 'been', 'being'] },
  { lemma: 'have', pos: 'v', ipa: 'hæv', ru: ['иметь', 'обладать', 'есть (у кого-то)'], forms: ['has', 'had', 'having'] },
  { lemma: 'do', pos: 'v', ipa: 'duː', ru: ['делать', 'выполнять'], forms: ['does', 'did', 'done', 'doing'] },
  { lemma: 'say', pos: 'v', ipa: 'seɪ', ru: ['говорить', 'сказать'], forms: ['says', 'said', 'saying'] },
  { lemma: 'go', pos: 'v', ipa: 'ɡoʊ', ru: ['идти', 'ехать', 'уходить'], forms: ['goes', 'went', 'gone', 'going'] },
  { lemma: 'get', pos: 'v', ipa: 'ɡet', ru: ['получать', 'добираться', 'становиться'], forms: ['got', 'gotten', 'getting'] },
  { lemma: 'make', pos: 'v', ipa: 'meɪk', ru: ['делать', 'создавать', 'заставлять'], forms: ['made', 'making'] },
  { lemma: 'know', pos: 'v', ipa: 'noʊ', ru: ['знать', 'быть знакомым'], forms: ['knew', 'known', 'knowing'] },
  { lemma: 'think', pos: 'v', ipa: 'θɪŋk', ru: ['думать', 'полагать'], forms: ['thought', 'thinking'] },
  { lemma: 'take', pos: 'v', ipa: 'teɪk', ru: ['брать', 'принимать', 'занимать (время)'], forms: ['took', 'taken', 'taking'] },
  { lemma: 'see', pos: 'v', ipa: 'siː', ru: ['видеть', 'понимать'], forms: ['saw', 'seen', 'seeing'] },
  { lemma: 'come', pos: 'v', ipa: 'kʌm', ru: ['приходить', 'приезжать'], forms: ['came', 'coming'] },
  { lemma: 'want', pos: 'v', ipa: 'wɒnt', ru: ['хотеть', 'нуждаться'] },
  { lemma: 'look', pos: 'v', ipa: 'lʊk', ru: ['смотреть', 'выглядеть'] },
  { lemma: 'find', pos: 'v', ipa: 'faɪnd', ru: ['находить', 'обнаруживать'], forms: ['found', 'finding'] },
  { lemma: 'give', pos: 'v', ipa: 'ɡɪv', ru: ['давать', 'дарить'], forms: ['gave', 'given', 'giving'] },
  { lemma: 'tell', pos: 'v', ipa: 'tel', ru: ['рассказывать', 'говорить (кому-то)', 'отличать'], forms: ['told', 'telling'] },
  { lemma: 'feel', pos: 'v', ipa: 'fiːl', ru: ['чувствовать', 'ощущать'], forms: ['felt', 'feeling'] },
  { lemma: 'leave', pos: 'v', ipa: 'liːv', ru: ['уходить', 'оставлять', 'покидать'], forms: ['left', 'leaving'] },
  { lemma: 'run', pos: 'v', ipa: 'rʌn', ru: ['бегать, бежать', 'работать (о механизме)', 'управлять'], forms: ['ran', 'running', 'runs'] },
  { lemma: 'begin', pos: 'v', ipa: 'bɪˈɡɪn', ru: ['начинать(ся)'], forms: ['began', 'begun', 'beginning'] },
  { lemma: 'sit', pos: 'v', ipa: 'sɪt', ru: ['сидеть', 'садиться'], forms: ['sat', 'sitting'] },
  { lemma: 'fall', pos: 'v', ipa: 'fɔːl', ru: ['падать', 'опускаться'], forms: ['fell', 'fallen', 'falling'] },
  { lemma: 'hear', pos: 'v', ipa: 'hɪər', ru: ['слышать', 'слушать'], forms: ['heard', 'hearing'] },
  { lemma: 'read', pos: 'v', ipa: 'riːd', ru: ['читать'], forms: ['reading', 'reads'] },
  { lemma: 'wonder', pos: 'v', ipa: 'ˈwʌndər', ru: ['интересоваться, задаваться вопросом', 'удивляться'] },
  { lemma: 'wonder', pos: 'n', ipa: 'ˈwʌndər', ru: ['чудо', 'удивление'] },
  { lemma: 'happen', pos: 'v', ipa: 'ˈhæpən', ru: ['случаться', 'происходить'] },
  { lemma: 'seem', pos: 'v', ipa: 'siːm', ru: ['казаться'] },
  { lemma: 'try', pos: 'v', ipa: 'traɪ', ru: ['пытаться', 'пробовать'], forms: ['tries', 'tried', 'trying'] },
  { lemma: 'stop', pos: 'v', ipa: 'stɒp', ru: ['останавливать(ся)', 'прекращать'], forms: ['stopped', 'stopping'] },
  { lemma: 'remember', pos: 'v', ipa: 'rɪˈmembər', ru: ['помнить', 'вспоминать'] },
  { lemma: 'notice', pos: 'v', ipa: 'ˈnoʊtɪs', ru: ['замечать'] },
  { lemma: 'dig', pos: 'v', ipa: 'dɪɡ', ru: ['копать'], forms: ['dug', 'digging'] },
  { lemma: 'peep', pos: 'v', ipa: 'piːp', ru: ['подглядывать', 'заглядывать'] },
  { lemma: 'rabbit', pos: 'n', ipa: 'ˈræbɪt', ru: ['кролик'] },
  { lemma: 'hole', pos: 'n', ipa: 'hoʊl', ru: ['нора', 'дыра', 'отверстие'] },
  { lemma: 'bank', pos: 'n', ipa: 'bæŋk', ru: ['берег (реки)', 'банк', 'насыпь'] },
  { lemma: 'sister', pos: 'n', ipa: 'ˈsɪstər', ru: ['сестра'] },
  { lemma: 'book', pos: 'n', ipa: 'bʊk', ru: ['книга'] },
  { lemma: 'picture', pos: 'n', ipa: 'ˈpɪktʃər', ru: ['картинка', 'изображение', 'картина'] },
  { lemma: 'conversation', pos: 'n', ipa: 'ˌkɒnvəˈseɪʃən', ru: ['разговор', 'беседа'] },
  { lemma: 'mind', pos: 'n', ipa: 'maɪnd', ru: ['ум', 'разум', 'мысли'] },
  { lemma: 'mind', pos: 'v', ipa: 'maɪnd', ru: ['возражать', 'обращать внимание', 'присматривать'] },
  { lemma: 'day', pos: 'n', ipa: 'deɪ', ru: ['день'] },
  { lemma: 'time', pos: 'n', ipa: 'taɪm', ru: ['время', 'раз'] },
  { lemma: 'way', pos: 'n', ipa: 'weɪ', ru: ['путь', 'способ', 'дорога'] },
  { lemma: 'thing', pos: 'n', ipa: 'θɪŋ', ru: ['вещь', 'предмет', 'дело'] },
  { lemma: 'eye', pos: 'n', ipa: 'aɪ', ru: ['глаз'] },
  { lemma: 'head', pos: 'n', ipa: 'hed', ru: ['голова', 'глава (руководитель)'] },
  { lemma: 'hand', pos: 'n', ipa: 'hænd', ru: ['рука (кисть)', 'стрелка (часов)'] },
  { lemma: 'door', pos: 'n', ipa: 'dɔːr', ru: ['дверь'] },
  { lemma: 'garden', pos: 'n', ipa: 'ˈɡɑːrdən', ru: ['сад'] },
  { lemma: 'glass', pos: 'n', ipa: 'ɡlæs', ru: ['стекло', 'стакан'] },
  { lemma: 'glasses', pos: 'n', ipa: 'ˈɡlæsɪz', ru: ['очки'] },
  { lemma: 'news', pos: 'n', ipa: 'nuːz', ru: ['новости'] },
  { lemma: 'child', pos: 'n', ipa: 'tʃaɪld', ru: ['ребёнок'], forms: ['children'] },
  { lemma: 'mouse', pos: 'n', ipa: 'maʊs', ru: ['мышь'], forms: ['mice'] },
  { lemma: 'foot', pos: 'n', ipa: 'fʊt', ru: ['нога (стопа)', 'фут'], forms: ['feet'] },
  { lemma: 'meeting', pos: 'n', ipa: 'ˈmiːtɪŋ', ru: ['встреча', 'собрание'] },
  { lemma: 'late', pos: 'adj', ipa: 'leɪt', ru: ['поздний', 'опоздавший', 'покойный'] },
  { lemma: 'late', pos: 'adv', ipa: 'leɪt', ru: ['поздно'] },
  { lemma: 'tired', pos: 'adj', ipa: 'ˈtaɪərd', ru: ['усталый', 'уставший'] },
  { lemma: 'curious', pos: 'adj', ipa: 'ˈkjʊəriəs', ru: ['любопытный', 'странный'] },
  { lemma: 'remarkable', pos: 'adj', ipa: 'rɪˈmɑːrkəbəl', ru: ['замечательный', 'примечательный'] },
  { lemma: 'large', pos: 'adj', ipa: 'lɑːrdʒ', ru: ['большой', 'крупный'], forms: ['larger', 'largest'] },
  { lemma: 'little', pos: 'adj', ipa: 'ˈlɪtəl', ru: ['маленький', 'немного'] },
  { lemma: 'deep', pos: 'adj', ipa: 'diːp', ru: ['глубокий'] },
  { lemma: 'quite', pos: 'adv', ipa: 'kwaɪt', ru: ['довольно', 'вполне', 'совсем'] },
  { lemma: 'suddenly', pos: 'adv', ipa: 'ˈsʌdənli', ru: ['внезапно', 'вдруг'] },
  { lemma: 'perhaps', pos: 'adv', ipa: 'pərˈhæps', ru: ['возможно', 'пожалуй'] },
  { lemma: 'once', pos: 'adv', ipa: 'wʌns', ru: ['однажды', 'один раз', 'как только'] },
  { lemma: 'twice', pos: 'adv', ipa: 'twaɪs', ru: ['дважды'] },
  { lemma: 'without', pos: 'prep', ipa: 'wɪˈðaʊt', ru: ['без'] },
  { lemma: 'through', pos: 'prep', ipa: 'θruː', ru: ['через', 'сквозь', 'по'] },
  { lemma: 'across', pos: 'prep', ipa: 'əˈkrɒs', ru: ['через', 'поперёк', 'по ту сторону'] },
  { lemma: 'under', pos: 'prep', ipa: 'ˈʌndər', ru: ['под'] },
  { lemma: 'not', pos: 'adv', ipa: 'nɒt', ru: ['не', 'нет'] },
  { lemma: 'will', pos: 'v', ipa: 'wɪl', ru: ['(вспомогательный глагол будущего времени)', 'хотеть'] },
  { lemma: 'would', pos: 'v', ipa: 'wʊd', ru: ['(условное наклонение)', 'бы'] },
  { lemma: 'can', pos: 'v', ipa: 'kæn', ru: ['мочь', 'уметь'], forms: ['could'] },
  { lemma: 'could', pos: 'v', ipa: 'kʊd', ru: ['мог бы', 'мог'] },
  { lemma: 'should', pos: 'v', ipa: 'ʃʊd', ru: ['следует', 'должен бы'] },
  { lemma: 'it', pos: 'pron', ipa: 'ɪt', ru: ['это', 'оно'] },
  { lemma: 'that', pos: 'pron', ipa: 'ðæt', ru: ['тот', 'то', 'который'] },
  { lemma: 'let', pos: 'v', ipa: 'let', ru: ['позволять', 'давай(те)'] },
  // Фразовые глаголы — отдельные статьи, ищутся через dict_phrasals.
  { lemma: 'give up', pos: 'phr v', ipa: 'ɡɪv ʌp', ru: ['бросать (привычку)', 'сдаваться', 'отказываться'], phrase: true },
  { lemma: 'look after', pos: 'phr v', ipa: 'lʊk ˈɑːftər', ru: ['присматривать за', 'заботиться о'], phrase: true },
  { lemma: 'look for', pos: 'phr v', ipa: 'lʊk fɔːr', ru: ['искать'], phrase: true },
  { lemma: 'find out', pos: 'phr v', ipa: 'faɪnd aʊt', ru: ['выяснять', 'узнавать'], phrase: true },
  { lemma: 'get up', pos: 'phr v', ipa: 'ɡet ʌp', ru: ['вставать', 'подниматься'], phrase: true },
  { lemma: 'sit down', pos: 'phr v', ipa: 'sɪt daʊn', ru: ['садиться'], phrase: true },
  { lemma: 'take off', pos: 'phr v', ipa: 'teɪk ɒf', ru: ['снимать (одежду)', 'взлетать'], phrase: true },
  { lemma: 'turn into', pos: 'phr v', ipa: 'tɜːrn ˈɪntuː', ru: ['превращаться в'], phrase: true },
  { lemma: 'make up', pos: 'phr v', ipa: 'meɪk ʌp', ru: ['выдумывать', 'составлять', 'мириться'], phrase: true },
  { lemma: 'run out', pos: 'phr v', ipa: 'rʌn aʊt', ru: ['заканчиваться', 'выбегать'], phrase: true },
  { lemma: 'run across', pos: 'phr v', ipa: 'rʌn əˈkrɒs', ru: ['случайно встретить', 'натолкнуться'], phrase: true },
];

export async function seedDictionary(db: SQLiteDatabase): Promise<void> {
  const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM dict_entries');
  if ((count?.n ?? 0) > 0) return;
  let rank = 0;
  for (const s of SEED) {
    rank += 1;
    const res = await db.runAsync(
      'INSERT INTO dict_entries (lemma, pos, ipa, freq_rank) VALUES (?, ?, ?, ?)',
      s.lemma, s.pos, s.ipa ?? null, rank,
    );
    const id = res.lastInsertRowId;
    for (let i = 0; i < s.ru.length; i++) {
      await db.runAsync('INSERT INTO dict_senses (entry_id, ord, ru) VALUES (?, ?, ?)', id, i, s.ru[i]);
    }
    for (const f of s.forms ?? []) {
      await db.runAsync('INSERT OR IGNORE INTO dict_forms (form, entry_id) VALUES (?, ?)', f, id);
    }
    if (s.phrase) {
      await db.runAsync('INSERT OR IGNORE INTO dict_phrasals (phrase, entry_id) VALUES (?, ?)', s.lemma, id);
    }
  }
}
