/**
 * Issue 57: the acoustic effects of the accents, tier medium, seed 1.
 * Run: node experiments/issue-57-acoustics.mjs
 */

import {
  burstToVoicing,
  consonantDip,
  consonants,
  renderAccent,
  segmentCentroid,
  voicedShare,
  vowelNpvi,
} from '../tests/helpers/accent-measures.js';

const fixed = (value, digits = 1) => value.toFixed(digits);
const first = (result) => consonants(result)[0];
const last = (result) => consonants(result).at(-1);

// (a) A fricative g: the first consonant of город stays loud.
for (const accent of ['ru-RU', 'ru-x-south']) {
  const result = renderAccent('город', 'ru', accent);
  console.log(
    `(a) город ${accent} /${result.ipa}/: dip ${fixed(consonantDip(result, first(result)))} dB`
  );
}

// (b) An unaspirated p: a short burst-to-voicing time.
for (const accent of ['en-US', 'en-x-ru']) {
  const result = renderAccent('pit', 'en', accent);
  console.log(
    `(b) pit ${accent} /${result.ipa}/: burst to voicing ${fixed(1000 * burstToVoicing(result, first(result)))} ms`
  );
}

// (c) A devoiced final d.
for (const accent of ['en-US', 'en-x-ru']) {
  const result = renderAccent('bad', 'en', accent);
  console.log(
    `(c) bad ${accent} /${result.ipa}/: last consonant voiced share ${fixed(voicedShare(result, last(result)), 2)}`
  );
}

// (d) 是 and 四 alike in Taiwan.
for (const accent of ['zh-CN', 'zh-TW']) {
  const shi = renderAccent('是', 'zh', accent);
  const si = renderAccent('四', 'zh', accent);
  const a = segmentCentroid(shi, first(shi));
  const b = segmentCentroid(si, first(si));
  console.log(
    `(d) 是 /${shi.ipa}/ ${fixed(a, 0)} Hz, 四 /${si.ipa}/ ${fixed(b, 0)} Hz (${accent}): ${fixed((100 * Math.abs(a - b)) / Math.max(a, b))} %`
  );
}

// (e) Syllable timing: a lower nPVI of the vowel durations.
const sentence = 'The tiger is the biggest animal of the family.';
for (const accent of ['en-US', 'en-x-zh']) {
  const result = renderAccent(sentence, 'en', accent);
  console.log(
    `(e) ${accent} /${result.ipa}/: vowel nPVI ${fixed(vowelNpvi(result))}`
  );
}
