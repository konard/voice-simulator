/** Three short end-to-end cases at 8 kHz. Unlicense. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { roundTrip, sentences } from './helpers/roundtrip.js';

for (const [lang, index] of [
  ['en', 17],
  ['ru', 1],
  ['zh', 1],
]) {
  it(`round trip ${lang}`, () => {
    const { spoken, heard, per, soundWer, languageRight } = roundTrip(
      sentences[lang][index],
      { lang, tier: 'telephone', preset: 'male', seed: 1 }
    );
    const failures = [];
    if (per.rate > 0.1) {
      failures.push(`PER ${per.distance}/${per.referenceLength} exceeds 10%`);
    }
    if (soundWer.rate !== 0) {
      failures.push(
        `Sound WER ${soundWer.distance}/${soundWer.referenceLength} exceeds 0%`
      );
    }
    if (!languageRight) {
      failures.push(
        `language was ${heard.languages[0]?.language ?? 'undetected'}`
      );
    }
    assert.equal(spoken.sampleRate, 8000);
    assert.equal(
      failures.length,
      0,
      `${failures.join('; ')}. Heard ${JSON.stringify(heard.text)}.`
    );
  });
}
