/** Compare exact word recovery with inferred versus supplied IPA boundaries. */
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { textToIpa, identifyLanguage, ipaToText } from '../src/index.js';
import { ipaKey, editDistance } from '../tests/helpers/ipa-recognition.js';
import { MIXED_LANGUAGE_COSTS } from '../src/recognition/ipa-to-text.js';

const fixtures = JSON.parse(
  readFileSync(
    new URL(
      '../tests/fixtures/recognition/mixed-sentences.json',
      import.meta.url
    ),
    'utf8'
  )
);
const inputs = fixtures.map(({ text, language }) => {
  const forward = textToIpa(text, { lang: language });
  return { text, forward, spans: identifyLanguage(forward.ipa).spans };
});
for (const mismatch of [0, 0.5, 1, 1.5, 2, 3, 4]) {
  for (const change of [0, 0.5, 1, 2]) {
    MIXED_LANGUAGE_COSTS.spanMismatch = mismatch;
    MIXED_LANGUAGE_COSTS.switch = change;
    for (const boundaries of [undefined, 'search', 'given']) {
      let recovered = 0;
      let total = 0;
      for (const { text, forward, spans } of inputs) {
        const expected = forward.words
          .filter((w) => ipaKey(w.ipa))
          .map((w) => `${w.lang}:${ipaKey(w.ipa)}`);
        const result = ipaToText(forward.ipa, {
          spans,
          boundaries,
        });
        const actual = result.words.map(
          (w) => `${w.language}:${ipaKey(w.ipa)}`
        );
        const correct = Math.max(
          0,
          expected.length - editDistance(expected, actual)
        );
        recovered += correct;
        total += expected.length;
        if (mismatch === 2 && change === 1) {
          console.log(
            JSON.stringify({
              boundaries: boundaries ?? 'auto',
              text,
              correct,
              total: expected.length,
              decoded: result.text,
            })
          );
        }
      }
      console.log(
        JSON.stringify({
          mismatch,
          change,
          boundaries: boundaries ?? 'auto',
          recovered,
          total,
          accuracy: recovered / total,
        })
      );
    }
  }
}
