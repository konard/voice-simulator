// Prototype of the weak-form pass planned in
// docs/case-studies/issue-11/plan/P73-english-function-words.md.
// It works on the result of textToIpa() and prints the IPA the plan expects,
// so that the values in the plan are measured and not written by hand.
// Run: node experiments/issue-11-weak-forms-prototype.mjs > experiments/issue-11-weak-forms-prototype.txt
import { textToIpa } from '../src/index.js';
import {
  adaptEnglishWord,
  hasLinkingR,
  isNonRhotic,
  resolveAccent,
} from '../src/g2p/accents.js';

const table = (kind, text) =>
  text.split(' ').map((pair) => {
    const [word, weak] = pair.split('=');
    return [word, { kind, weak }];
  });

const WEAK_FORMS = new Map([
  ...table('article', 'a=ə an=ən the=ðə'),
  ...table('conjunction', 'and=ənd but=bət or=ɔɹ as=əz than=ðən if=ɪf'),
  ...table(
    'preposition',
    'of=əv to=tə for=fɚ from=fɹəm at=ət in=ɪn on=ɑn with=wɪð by=baɪ'
  ),
  ...table(
    'auxiliary',
    'am=əm is=ɪz are=ɚ was=wəz were=wɚ be=bi been=bɪn have=hæv has=hæz ' +
      'had=hæd do=du does=dʌz can=kən could=kəd will=wəl would=wəd ' +
      'shall=ʃəl should=ʃəd must=məst'
  ),
  ...table(
    'pronoun',
    'i=aɪ you=ju he=hi she=ʃi we=wi they=ðeɪ it=ɪt me=mi him=hɪm her=hɚ ' +
      'us=əs them=ðəm my=maɪ your=jɚ his=hɪz its=ɪts our=ɑɹ their=ðɛɹ'
  ),
]);
const BEFORE_VOWEL = { the: 'ði', to: 'tu' };
const BEFORE_TO = {
  have: 'ˈhæf',
  has: 'ˈhæs',
  used: 'ˈjus',
  supposed: 'səˈpoʊs',
};
const DETERMINERS = new Set(
  'a an the my your his her its our their this that'.split(' ')
);
const BE_FORMS = new Set('am is are was were be been being'.split(' '));
const VOWEL_START = /^[ˈˌ]?[aeiouæɑɒɔəɛɪʊʌɜɝɚ]/u;
const BREAK = /[.?!…,;:|()"—–]/u;

const lower = (item) => item?.text.toLowerCase();

function keepsStrong(entry, previous, next) {
  const stranded = !next;
  if (entry.kind === 'preposition') {
    return stranded;
  }
  if (entry.kind === 'auxiliary') {
    return (
      stranded || lower(next) === 'not' || DETERMINERS.has(lower(previous))
    );
  }
  return false;
}

function weakIpa(item, previous, next) {
  const word = lower(item);
  if (lower(next) === 'to' && BEFORE_TO[word]) {
    return word === 'used' && BE_FORMS.has(lower(previous))
      ? null
      : BEFORE_TO[word];
  }
  const entry = WEAK_FORMS.get(word);
  if (!entry || item.lang !== 'en' || item.letter) {
    return null;
  }
  if (keepsStrong(entry, previous, next)) {
    return null;
  }
  return next && VOWEL_START.test(next.ipa) && BEFORE_VOWEL[word]
    ? BEFORE_VOWEL[word]
    : entry.weak;
}

function weakenPhrase(phrase, accent) {
  const strong = phrase.map((item) => item.ipa);
  phrase.forEach((item, index) => {
    const ipa = weakIpa(item, phrase[index - 1], phrase[index + 1]);
    if (ipa) {
      // No spelling: the accent overrides by spelling are strong forms.
      item.ipa = adaptEnglishWord(ipa, '', accent);
      item.linkingR = hasLinkingR(ipa);
      item.weak = true;
    }
  });
  if (!phrase.some((item) => item.ipa.includes('ˈ'))) {
    const index = phrase.findLastIndex(
      (item) => item.weak && lower(item) !== 'it'
    );
    const restore = index < 0 ? phrase.length - 1 : index;
    phrase[restore].ipa = strong[restore];
  }
}

function speak(text, lang = 'en-US') {
  const result = textToIpa(text, { lang });
  const accent = resolveAccent('en', lang.split('-')[1]);
  const phrases = [[]];
  result.words.forEach((word, index) => {
    const previous = result.words[index - 1];
    if (
      previous &&
      BREAK.test(text.slice(previous.sourceEnd, word.sourceStart))
    ) {
      phrases.push([]);
    }
    phrases.at(-1).push({ ...word, linkingR: hasLinkingR(word.ipa) });
  });
  phrases.forEach((phrase) => weakenPhrase(phrase, accent));
  const words = phrases.flat();
  if (isNonRhotic(accent)) {
    words.forEach((item, index) => {
      const next = words[index + 1];
      const sameSource = result.words[index].ipa === item.ipa;
      if (!sameSource && item.linkingR && next && VOWEL_START.test(next.ipa)) {
        item.ipa += 'ɹ';
      }
    });
  }
  return phrases
    .map((phrase) => phrase.map((item) => item.ipa).join(' '))
    .join(' | ');
}

for (const text of [
  'the apple and the pear',
  'the end',
  'a cup of tea for you',
  'an apple',
  'I can do it',
  'Yes, I can.',
  // eslint-disable-next-line local/no-changelog-comments -- a test sentence
  'I used to live there',
  'It is used to make bread',
  'I have to go',
  'She has to eat',
  'He was at home',
  'What are you looking at?',
  'She gave it to him',
  'to and from the office',
  'to eat',
  'a can of beans',
  'my will is strong',
  'You must not go',
  'Is it?',
  'It is.',
  'For you.',
  'you',
  'can',
  'at',
  'He said that we would come',
  'They were as good as us',
  'I saw them and their dog',
  'Hello! This voice is simulated by sound waves in a 3D head.',
]) {
  console.log(`en-US ${text}: ${JSON.stringify(speak(text))}`);
}
for (const text of [
  'for a while',
  'a cup of tea for you',
  'I can do it',
  'He was at home',
  'I have to go',
  'far from her',
  'What are you looking at?',
]) {
  console.log(`en-GB ${text}: ${JSON.stringify(speak(text, 'en-GB'))}`);
}
