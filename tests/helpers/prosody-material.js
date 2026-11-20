import {
  synthesize,
  parseIpa,
  presetHeadConfig,
  resample,
} from '../../src/index.js';
import { measureProsody } from '../../src/recognition/prosody.js';
import { plannedPhones } from './decoder-material.js';

export const PRESETS = ['male', 'female'];

export function render(text, language, preset, extra) {
  const head = presetHeadConfig(preset);
  const audio = synthesize(text, {
    lang: language,
    head,
    tier: 'minimal',
    engine: 'js',
    seed: 1,
    ...extra,
  });
  const words = audio.timeline.words.map(
    ({ text, ipa, syllables, start, end }) => ({
      text: text.toLowerCase(),
      ipa,
      syllables,
      language,
      start,
      end,
      confidence: 1,
    })
  );
  const result = { words, modes: [], text: '', ipa: '' };
  const sounds = [
    ...plannedPhones(audio.plan).map((sound) => ({ ...sound, confidence: 1 })),
    ...audio.plan.segments
      .filter(({ kind, duration }) => kind === 'pause' && duration > 0)
      .map(({ start, end }) => ({ ipa: '|', start, end, confidence: 1 })),
  ].sort((a, b) => a.start - b.start);
  return { audio, result, sounds };
}

export function measure({ audio, sounds }, rate = audio.sampleRate) {
  const samples =
    rate === audio.sampleRate
      ? audio.samples
      : resample(audio.samples, audio.sampleRate, rate);
  return measureProsody(samples, rate, sounds, {
    voice: audio.head,
    language: audio.lang,
  });
}

export function syllableTone(ipa) {
  const tone = parseIpa(ipa).tokens.findLast((token) => token.tone)?.tone;
  return (tone ?? []).map((level) => '˩˨˧˦˥'[level - 1]).join('');
}

export function syllableNuclei(syllable, measured) {
  return measured.sounds.filter(
    ({ start, end, prominence }) =>
      prominence !== undefined &&
      start >= syllable.start - 1e-8 &&
      end <= syllable.end + 1e-8
  );
}

export const STRESS = {
  en: [
    'apple',
    'about',
    'paper',
    'river',
    'today',
    'morning',
    'letter',
    'window',
    'together',
    'remember',
    'tomorrow',
    'banana',
    'holiday',
    'piano',
    'umbrella',
    'potato',
    'music',
    'doctor',
    'garden',
    'forest',
    'yellow',
    'happy',
    'water',
    'summer',
    'another',
    'attention',
    'important',
    'elephant',
    'beautiful',
    'calendar',
    'family',
    'camera',
    'America',
    'disagree',
    'information',
    'beautifully',
    'remembering',
    'tomatoes',
    'beginning',
    'discovery',
  ],
  ru: [
    'мама',
    'папа',
    'вода',
    'рука',
    'окно',
    'трава',
    'книга',
    'рыба',
    'молоко',
    'дорога',
    'работа',
    'собака',
    'комната',
    'корова',
    'берёза',
    'лопата',
    'утро',
    'солнце',
    'город',
    'осень',
    'море',
    'ветер',
    'лето',
    'школа',
    'учитель',
    'картина',
    'цветочек',
    'деревня',
    'магазин',
    'облако',
    'золото',
    'девочка',
    'телевизор',
    'велосипед',
    'половина',
    'апельсины',
    'черепаха',
    'черника',
    'серединка',
    'паровозик',
  ],
};

export const SENTENCES = {
  en: [
    'The sun is up.',
    'It is a red car.',
    'We can go home.',
    'The book is on the table.',
    'Are you coming?',
    'Can you see me?',
    'It is yours?',
    'Where are you?',
    'What is that?',
    'That is fine. Stop!',
  ],
  ru: [
    'Мама дома.',
    'Папа читает книгу.',
    'Я вижу собаку.',
    'Птица летит домой.',
    'Ты идёшь домой?',
    'Мама купила рыбу?',
    'Они читали книгу?',
    'Где ты живёшь?',
    'Кто читает книгу?',
    'Это моя книга. Ура!',
  ],
  hi: [
    'यह मेरा घर है।',
    'राम घर जाता है।',
    'आज मौसम अच्छा है।',
    'वह पानी पीता है।',
    'क्या तुम घर जा रहे हो?',
    'क्या तुम तैयार हो?',
    'तुम घर आ रहे हो?',
    'तुम कहाँ जा रहे हो?',
    'तुम कैसे हो?',
    'वह घर पर है। वाह!',
  ],
  zh: [
    '今天天气很好。',
    '小猫正在睡觉。',
    '妈妈喜欢喝茶。',
    '我想去公园。',
    '你好吗？',
    '你喜欢喝茶吗？',
    '你今天回家？',
    '你在哪里？',
    '你想吃什么？',
    '我们到了。好棒！',
  ],
};

export const SENTENCE_MARKS = [
  '.',
  '.',
  '.',
  '.',
  '?',
  '?',
  '?',
  '↘ ?',
  '↘ ?',
  '!',
];
