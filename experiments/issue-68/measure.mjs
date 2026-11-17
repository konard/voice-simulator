/** Bounded deterministic recognition measurements; no network or synthesis. */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { textToIpa } from '../../src/g2p/index.js';
import { formatIpa } from '../../src/ipa/parse.js';
import { createRandom } from '../../src/random.js';
import { ipaToText } from '../../src/recognition/ipa-to-text.js';
import { getLexicon } from '../../src/recognition/lexicon.js';
import { getCounts } from '../../src/recognition/data/index.js';
import { spellSounds } from '../../src/recognition/phones-to-letters.js';

import {
  sentences as fixture,
  sounds,
  ipaKey as key,
  soundWords,
  editDistance as edits,
  nearestOther as nearest,
} from '../../tests/helpers/ipa-recognition.js';

const report = {};
for (const language of process.argv.slice(2).filter((s) => !s.startsWith('--'))
  .length
  ? process.argv.slice(2).filter((s) => !s.startsWith('--'))
  : ['en', 'ru', 'hi', 'zh']) {
  const random = createRandom(1);
  const cold = performance.now();
  getLexicon(language);
  const result = {
    coldMs: performance.now() - cold,
    vocabulary: { total: 0, sounds: 0, spelling: 0, failures: [] },
    sentences: [],
    unknown: { total: 0, sounds: 0, failures: [] },
  };
  const limit = process.argv.includes('--quick') ? 200 : 5000;
  for (const { word } of getCounts(language).words.slice(0, limit)) {
    const forward = textToIpa(word, { lang: language });
    const back = ipaToText(forward.ipa, { language });
    const same = key(forward.ipa) === key(back.ipa);
    result.vocabulary.total++;
    result.vocabulary.sounds += Number(same);
    result.vocabulary.spelling += Number(back.text === word);
    if (
      (!same || back.text !== word) &&
      result.vocabulary.failures.length < 20
    ) {
      result.vocabulary.failures.push({
        word,
        got: back.text,
        ipa: forward.ipa,
        out: back.ipa,
      });
    }
  }
  for (const sentence of fixture[language]) {
    const forward = textToIpa(sentence, { lang: language });
    const back = ipaToText(forward.ipa, { language });
    const search = ipaToText(forward.ipa.replaceAll(' ', ''), {
      language,
      boundaries: 'search',
    });
    const expected = soundWords(forward.words, language);
    const corrupted = sounds(forward.ipa).map((t) =>
      random() < 0.1 ? nearest(t) : t
    );
    const noisy = ipaToText(formatIpa(corrupted).replaceAll(' ', ''), {
      language,
      boundaries: 'search',
    });
    const spellingExpected =
      language === 'zh'
        ? [...sentence.replaceAll(' ', '')]
        : sentence.split(' ');
    result.sentences.push({
      sentence,
      text: back.text,
      sameSounds: key(back.ipa) === key(forward.ipa),
      spellingErrors: edits(
        spellingExpected,
        language === 'zh' ? [...back.text] : back.text.split(' ')
      ),
      spellingTotal: spellingExpected.length,
      boundaryErrors: edits(expected, soundWords(search.words, language)),
      soundTotal: expected.length,
      search: search.text,
      noiseErrors: edits(expected, soundWords(noisy.words, language)),
      noisy: noisy.text,
    });
  }
  for (const { word } of getCounts(language).words.slice(0, 200)) {
    const ipa = textToIpa(word, { lang: language }).ipa;
    const spelling = spellSounds(sounds(ipa), language);
    const spoken = textToIpa(spelling, { lang: language }).ipa;
    const same = key(ipa) === key(spoken);
    result.unknown.total++;
    result.unknown.sounds += Number(same);
    if (!same && result.unknown.failures.length < 20) {
      result.unknown.failures.push({ word, spelling, ipa, spoken });
    }
  }
  console.log(language, JSON.stringify(result));
  report[language] = result;
}
writeFileSync(
  '/tmp/issue-68-measurements.json',
  JSON.stringify(report, null, 2)
);
