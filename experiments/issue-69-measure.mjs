/** Reproducible language-ID calibration; no audio, network or random corpus. */
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { textToIpa } from '../src/g2p/index.js';
import { identifyLanguage } from '../src/recognition/language-id.js';
import { ipaToText } from '../src/recognition/ipa-to-text.js';
import { getCounts } from '../src/recognition/data/index.js';
import { sounds, sentences } from '../tests/helpers/ipa-recognition.js';
const languages = ['en', 'ru', 'hi', 'zh'];
for (const language of languages) {
  const matrix = Object.fromEntries(languages.map((l) => [l, 0]));
  let seen = 0;
  for (const { word } of getCounts(language).words) {
    const ipa = textToIpa(word, { lang: language }).ipa;
    if (sounds(ipa).length < 4) {
      continue;
    }
    matrix[identifyLanguage(ipa).languages[0].language]++;
    if (++seen === 2000) {
      break;
    }
  }
  console.log(language, matrix);
  let correct = 0;
  for (const text of sentences[language]) {
    const result = identifyLanguage(textToIpa(text, { lang: language }).ipa);
    correct += Number(result.languages[0].language === language);
    if (result.languages[0].language !== language) {
      console.log('wrong sentence', text, result);
    }
  }
  console.log('sentences', language, correct);
}
const fixtures = JSON.parse(
  readFileSync(
    new URL(
      '../tests/fixtures/recognition/mixed-sentences.json',
      import.meta.url
    ),
    'utf8'
  )
);
let correct = 0;
let total = 0;
for (const { text, language } of fixtures) {
  const forward = textToIpa(text, { lang: language });
  const result = identifyLanguage(forward.ipa);
  let at = 0;
  const words = forward.words
    .filter((word) => sounds(word.ipa).length)
    .map((word) => {
      const from = at;
      at += sounds(word.ipa).length;
      const detected = result.spans.find(
        (span) => span.from <= from && from < span.to
      )?.language;
      correct += Number(detected === word.lang);
      total++;
      return `${word.text}/${word.lang}:${detected}`;
    });
  console.log(
    text,
    forward.ipa,
    words.join(' '),
    result.spans.map((s) => `${s.language}:${s.from}-${s.to}`)
  );
  console.log('decoded', ipaToText(forward.ipa, { spans: result.spans }).text);
}
console.log('mixed words', correct, total, correct / total);
console.log('acceptance', identifyLanguage('ɐˈna skɐˈzaɫə ˈθæŋk ˈju i ˈuʂɫə'));
