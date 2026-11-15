// F1 of a static vowel tract against the reflection at the glottal end
// (issue 34): 1 is a closed glottis, lower values an open one that
// absorbs and lets the end look partly open. Shows where the first
// formant goes while the glottis is open, where the interactive flow
// rings (experiments/issue-11-interaction.txt).
// Usage: node experiments/issue-34-open-f1.mjs [ipa]
import { DEFAULT_HEAD, normalizeHeadConfig } from '../src/head-config.js';
import { tractResonance, vowelShape } from '../tests/helpers/interaction.js';

const ipa = process.argv[2] ?? 'ˈɑː';
const shape = vowelShape(ipa, normalizeHeadConfig(DEFAULT_HEAD));
console.log(
  `${ipa}: glottal end ${shape.areas[0].toFixed(2)} cm², length ${shape.length.toFixed(1)} cm`
);
for (const reflection of [1, 0.8, 0.6, 0.4, 0.3, 0.2, 0, -0.2]) {
  const f1 = tractResonance(ipa, reflection);
  console.log(
    `  reflection ${reflection}: F1 ${f1.frequency.toFixed(0)} Hz, bandwidth ${f1.bandwidth.toFixed(0)} Hz`
  );
}
