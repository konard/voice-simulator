// Audit of the language front end for the plan of issue 11 (P31..P37).
// Run: node experiments/issue-11-audit-m3a.mjs > experiments/issue-11-audit-m3a.txt
import { gzipSync } from 'node:zlib';
import { textToIpa, planUtterance, prepareUtterance } from '../src/index.js';
import { englishDictionarySize } from '../src/g2p/english.js';
import { RUSSIAN_STRESS } from '../src/g2p/russian-stress.js';
import { CHINESE_READINGS } from '../src/g2p/chinese-dict.js';
import { ENGLISH_DICTIONARY } from '../src/g2p/english-dict.js';

const show = (label, value) =>
  console.log(`${label}: ${JSON.stringify(value)}`);
const ipa = (text, lang) => textToIpa(text, { lang }).ipa;

// 1. Mandarin erhua (P31).
for (const text of [
  '花儿',
  '一点儿',
  '小孩儿',
  '玩儿',
  '事儿',
  '空儿',
  '哪儿',
  '儿子',
  '女儿',
  '儿童',
  'huār',
  'yìdiǎnr',
]) {
  show(`zh ${text}`, ipa(text, 'zh'));
}

// 2. English heteronyms (P32).
for (const text of [
  'I read the book yesterday.',
  'I will read the book.',
  'Did you record the record?',
  'I live here. A live show.',
  'A lead pipe. They lead the team.',
  'The wind blows. Wind the clock.',
  'A tear in her eye. Do not tear the page.',
  'Take a bow. A bow and arrow.',
  'Close the door. Stay close to me.',
  'I use it. It is of no use.',
  'A present for you. They present the plan.',
  'The object is red. I object to that.',
  'The dove flew. He dove in.',
  'A minute ago. A minute detail.',
  'The bass guitar. A bass swam by.',
]) {
  show('en', ipa(text, 'en'));
}

// 3. Hindi questions with क्या (P33).
for (const text of [
  'क्या तुम आओगे?',
  'तुम आओगे?',
  'तुम क्या खाओगे?',
  'यह क्या है?',
  'क्या हुआ?',
  'क्या बात है?',
  'क्या आप ठीक हैं?',
  'आप कहाँ जा रहे हैं?',
  'आप कल कहाँ जा रहे हैं?',
  'तुम्हारा नाम क्या है?',
]) {
  const { plan } = prepareUtterance(text, { lang: 'hi', tier: 'minimal' });
  const vowels = plan.segments.filter((segment) => segment.kind === 'vowel');
  const at = (time) =>
    Math.round(plan.channels.f0[Math.round(time * plan.frameRate)]);
  const last = vowels.at(-1);
  show(`hi ${text}`, {
    ipa: ipa(text, 'hi'),
    lastVowelStart: at(last.start + 0.02),
    lastVowelEnd: at(last.end - 0.02),
  });
}

// 4. Highlighting of expanded tokens (P34).
for (const [lang, text] of [
  ['en', 'I have 25 apples on 3/4/2024.'],
  ['en', 'It costs $5 at 3:30.'],
  ['ru', 'У меня 25 яблок.'],
  ['zh', '我有25个'],
  ['hi', 'मेरे पास 25 सेब हैं।'],
]) {
  const { timeline } = prepareUtterance(text, { lang, tier: 'minimal' });
  show(
    `highlight ${lang}`,
    timeline.words.map((word) => ({
      text: word.text,
      ipa: word.ipa,
      syllables: word.syllables.map((syllable) => syllable.text ?? null),
    }))
  );
}

// 5. Size of the built-in lexicons (P35).
show('lexicon sizes', {
  englishWords: englishDictionarySize(),
  russianStressWords: RUSSIAN_STRESS.split(' ').length,
  chineseSyllables: CHINESE_READINGS.split(' ').length,
  chineseCharacters: CHINESE_READINGS.replace(/[^\p{Script=Han}]/gu, '').length,
});
for (const [lang, words] of [
  ['en', 'onomatopoeia quinoa colonel choir yacht Worcester segue'],
  ['zh', '重庆 还钱 得到 首都 行为 教书 干净 少年 大夫 数数 照相 有空 着急'],
  ['zh', '种子 种树 慢慢地 漂亮 木头 喜欢 明白 看看 银行 长大 觉得'],
  ['hi', 'समझना समझा धड़कने धड़कनें लोकसभा ज्ञान यह वह बहन'],
]) {
  show(
    lang,
    textToIpa(words, { lang }).words.map(
      (word) => `${word.original}=${word.ipa}(${word.source})`
    )
  );
}

// 6. Russian stress (P36).
show(
  'ru',
  textToIpa(
    'замок замке часов города голова головы молоко хорошо говорит ' +
      'карандаш телефон магазин учительница красивая понимаю ' +
      'стоит стоит белки большая большая',
    { lang: 'ru' }
  ).words.map((word) => `${word.original}=${word.ipa}(${word.source})`)
);
show('ru marked', ipa('замо́к з+амок часо́в города́', 'ru'));
show('ru yo', ipa('ещё еще все всё ёлка елка', 'ru'));
for (const text of [
  'Ключ от замка. Старый замок на горе.',
  'Это стоит дорого. Он стоит там.',
  '5 часов. 3 часа. Встреча в 17:00.',
  'Мы пошли в лес. Они увидели дерево. Сегодня хорошая погода.',
  'Я купил телефон в магазине.',
  'еще ее елка зеленый идет пришел',
]) {
  show(`ru ${text}`, ipa(text, 'ru'));
}

// 7. Mandarin tone sandhi and the neutral tone (P37).
for (const text of [
  '不是',
  '不好',
  '是不是',
  '一个',
  '一天',
  '一起',
  '第一',
  '第一名',
  '十一月',
  '一九九一',
  '看一看',
  '我很好',
  '我也很好',
  '小老虎',
  '妈妈',
  '爷爷',
  '奶奶',
  '爸爸',
  '我的',
  '好吗',
]) {
  const result = textToIpa(text, { lang: 'zh' });
  show(`zh ${text}`, result.ipa);
}
for (const text of ['妈妈', '爷爷', '奶奶', '爸爸']) {
  const plan = planUtterance(ipa(text, 'zh'), { language: 'zh' });
  const vowels = plan.segments.filter((segment) => segment.kind === 'vowel');
  const at = (time) =>
    Math.round(plan.channels.f0[Math.round(time * plan.frameRate)]);
  show(
    `zh f0 ${text}`,
    vowels.map((vowel) => [at(vowel.start + 0.02), at(vowel.end - 0.02)])
  );
  show(
    `zh duration ${text}`,
    vowels.map((vowel) => Math.round((vowel.end - vowel.start) * 1000))
  );
}

// 8. Prototype of the compact lexicon container (P35): the English
// dictionary of today, front coded in blocks of 64 words, one character per
// phoneme. Prints the size next to the size of the `word=ipa` text.
{
  const text = Array.isArray(ENGLISH_DICTIONARY)
    ? ENGLISH_DICTIONARY.join(' ')
    : ENGLISH_DICTIONARY;
  const pairs = text
    .split(/\s+/)
    .filter(Boolean)
    .map((entry) => {
      const index = entry.indexOf('=');
      return [entry.slice(0, index), entry.slice(index + 1)];
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const UNITS = ['t͡ʃ', 'd͡ʒ', 'aɪ', 'aʊ', 'eɪ', 'oʊ', 'ɔɪ'];
  const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&()*+,:;<=>?@[]^_{}|~';
  const symbols = new Map();
  const encode = (value) => {
    let out = '';
    for (let i = 0; i < value.length; ) {
      const unit = UNITS.find((u) => value.startsWith(u, i)) ?? value[i];
      if (!symbols.has(unit)) {
        symbols.set(unit, CODE[symbols.size] ?? '?');
      }
      out += symbols.get(unit);
      i += unit.length;
    }
    return out;
  };
  let body = '';
  let previous = '';
  pairs.forEach(([word, value], index) => {
    let shared = 0;
    if (index % 64 !== 0) {
      while (
        shared < 9 &&
        shared < previous.length &&
        shared < word.length &&
        previous[shared] === word[shared]
      ) {
        shared++;
      }
    }
    body += shared + word.slice(shared) + encode(value);
    previous = word;
  });
  const bytes = Buffer.byteLength(body);
  show('lexicon container', {
    words: pairs.length,
    symbols: symbols.size,
    bytes,
    bytesPerWord: Number((bytes / pairs.length).toFixed(2)),
    gzip: gzipSync(Buffer.from(body)).length,
    textBytes: Buffer.byteLength(text),
    textGzip: gzipSync(Buffer.from(text)).length,
  });
  show('lexicon container start', body.slice(0, 60));
}
