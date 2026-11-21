/** Measure transcription when the phone decoder supplies exact IPA. Unlicense. */
import assert from 'node:assert/strict';
import { formatIpa, parseIpa, recognize, textToIpa } from '../src/index.js';
import { roundTrip, sentences } from '../tests/helpers/roundtrip.js';

for (const [lang, texts] of Object.entries(sentences)) {
  let soundEdits = 0;
  let referenceWords = 0;
  let languageHits = 0;
  const wrong = [];
  for (const text of texts) {
    const { ipa } = textToIpa(text, { lang });
    const phones = formatIpa(
      parseIpa(ipa).tokens.filter(({ kind }) =>
        ['vowel', 'consonant', 'pause'].includes(kind)
      )
    );
    const result = roundTrip(text, {
      lang,
      tier: 'telephone',
      preset: 'male',
      seed: 1,
      recognize: (samples, sampleRate, options) =>
        recognize(samples, sampleRate, {
          ...options,
          modes: false,
          stages: { audioToIpa: () => ({ ipa: phones }) },
        }),
    });
    assert.equal(result.spoken.ipa, ipa);
    soundEdits += result.soundWer.distance;
    referenceWords += result.soundWer.referenceLength;
    languageHits += Number(result.languageRight);
    if (result.soundWer.distance || !result.languageRight) {
      wrong.push({
        reference: text,
        ipa: phones,
        heard: result.heard.text,
        language: result.heard.languages[0]?.language,
      });
    }
  }
  console.log(
    JSON.stringify({ lang, soundEdits, referenceWords, languageHits })
  );
  for (const result of wrong) {
    console.log(JSON.stringify(result));
  }
}
