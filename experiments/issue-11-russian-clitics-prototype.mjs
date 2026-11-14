// Prototype of the clitic pass planned in
// docs/case-studies/issue-11/plan/P74-russian-clitics.md.
// It works on the result of textToIpa() and prints the IPA the plan expects,
// so that the values in the plan are measured and not written by hand.
// Run: node experiments/issue-11-russian-clitics-prototype.mjs > experiments/issue-11-russian-clitics-prototype.txt
import { textToIpa } from '../src/index.js';

// word: [form right before the stressed syllable of the host, form elsewhere]
const pairs = (text) =>
  text.split(' ').map((entry) => {
    const [word, near, far] = entry.split('=');
    return [word, [near, far ?? near]];
  });
const PROCLITICS = new Map(
  pairs(
    'в=v во=vɐ=və к=k ко=kɐ=kə с=s со=sɐ=sə о=ɐ об=ɐb обо=ɐbɐ=ɐbə ' +
      'от=ɐt ото=ɐtɐ=ɐtə до=dɐ=də по=pɐ=pə под=pɐd=pəd подо=pədɐ=pədə ' +
      'над=nɐd=nəd из=ɪz изо=ɪzɐ=ɪzə за=zɐ=zə на=nɐ=nə без=bʲɪz для=dlʲɪ ' +
      'при=prʲɪ про=prɐ=prə через=t͡ɕɪrʲɪz перед=pʲɪrʲɪd ' +
      'передо=pʲɪrʲɪdɐ=pʲɪrʲɪdə у=ʊ не=nʲɪ ни=nʲɪ'
  )
);
const ENCLITICS = new Map([
  ['же', 'ʐɨ'],
  ['ли', 'lʲɪ'],
  ['бы', 'bɨ'],
]);
const VOICING_ENCLITICS = new Set(['же', 'бы']);
const DEVOICE = { b: 'p', v: 'f', ɡ: 'k', d: 't', z: 's', ʐ: 'ʂ' };
const VOICE = Object.fromEntries(
  Object.entries(DEVOICE).map(([voiced, voiceless]) => [voiceless, voiced])
);
const VOICELESS_START = /^[pfktsʂxɕ]/u;
const VOICED_START = /^[bɡdzʐ]/u;
const VOWEL = /[aeiouɨəɐɪʊɛɔ]/gu;
const BREAK = /[.?!…,;:|()"—–]/u;

const lower = (item) => item?.text.toLowerCase();
const STRESS_MARK = new RegExp('\\+|\\u0301', 'u');
const hasStressMark = (item) =>
  STRESS_MARK.test((item.original ?? item.text).normalize('NFD'));
const isProclitic = (item) =>
  item?.lang === 'ru' && PROCLITICS.has(lower(item)) && !hasStressMark(item);

/** Change the voicing of the last consonant, keeping a palatal mark. */
function setFinalVoicing(ipa, table) {
  const mark = ipa.endsWith('ʲ') ? 'ʲ' : '';
  const body = mark ? ipa.slice(0, -1) : ipa;
  const last = body.at(-1);
  return table[last] ? `${body.slice(0, -1)}${table[last]}${mark}` : ipa;
}

function procliticIpa(item, host) {
  const [near, far] = PROCLITICS.get(lower(item));
  const before = host.ipa.split('ˈ')[0];
  const pretonic =
    !isProclitic(host) &&
    (!host.ipa.includes('ˈ') || (before.match(VOWEL) ?? []).length === 0);
  const form = pretonic ? near : far;
  const start = host.ipa.replace('ˈ', '');
  if (VOICELESS_START.test(start)) {
    return setFinalVoicing(form, DEVOICE);
  }
  return VOICED_START.test(start) ? setFinalVoicing(form, VOICE) : form;
}

function joinPhrase(phrase) {
  for (let index = phrase.length - 1; index >= 0; index--) {
    const item = phrase[index];
    const next = phrase[index + 1];
    const previous = phrase[index - 1];
    if (isProclitic(item) && next?.lang === 'ru') {
      item.ipa = procliticIpa(item, next);
      item.clitic = true;
      if (/[^aeiouɨəɐɪʊɛɔʲ]$/u.test(item.ipa) && !next.clitic) {
        next.ipa = next.ipa.replace(/^(ˈ?)[iɪ]/u, '$1ɨ');
      }
    } else if (
      item.lang === 'ru' &&
      ENCLITICS.has(lower(item)) &&
      previous?.lang === 'ru'
    ) {
      item.ipa = ENCLITICS.get(lower(item));
      item.clitic = true;
      if (VOICING_ENCLITICS.has(lower(item)) && !isProclitic(previous)) {
        previous.ipa = setFinalVoicing(previous.ipa, VOICE);
      }
    }
  }
}

function speak(text) {
  const result = textToIpa(text, { lang: 'ru' });
  const phrases = [[]];
  result.words.forEach((word, index) => {
    const previous = result.words[index - 1];
    if (
      previous &&
      BREAK.test(text.slice(previous.sourceEnd, word.sourceStart))
    ) {
      phrases.push([]);
    }
    phrases.at(-1).push({ ...word });
  });
  phrases.forEach(joinPhrase);
  return phrases
    .map((phrase) => phrase.map((item) => item.ipa).join(' '))
    .join(' | ');
}

for (const text of [
  'из дома',
  'из парка',
  'от брата',
  'от мамы',
  'в доме',
  'в парке',
  'с братом',
  'с другом',
  'к маме',
  'к дому',
  'к вам',
  'об этом',
  'без меня',
  'для меня',
  'у меня',
  'на работе',
  'на дорогу',
  'по дороге',
  'до завтра',
  'за домом',
  'под домом',
  'над домом',
  'перед домом',
  'через дорогу',
  'при этом',
  'про это',
  'со мной',
  'ко мне',
  'обо мне',
  'с Иваном',
  'от Ивана',
  'к Ивану',
  'из-за дома',
  'из-под дома',
  'Я не знаю',
  'ни разу',
  'не для меня',
  'Он же сказал',
  'как же',
  'вот бы',
  'брат бы',
  'друг же',
  'знаешь ли',
  'сказал бы',
  'Он сказал, в доме',
  'на́ гору',
  'н+а гору',
  'на',
  'в',
  'не',
  'Да, на.',
  'бы',
  'в 5 часов',
  'в office',
  'Книгу о доме',
  'Я хочу к маме, а не к брату.',
]) {
  const today = textToIpa(text, { lang: 'ru' }).ipa;
  console.log(
    `ru ${text}: ${JSON.stringify(speak(text))}   today: ${JSON.stringify(today)}`
  );
}
