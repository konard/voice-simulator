/**
 * Per-frame c0 (dB below the loudest frame), c1, voicing and plan label of
 * a span of a round-trip sentence, to see the closure and release of a
 * stop as the HMM features see them.
 * node experiments/issue-75-closure-energy.mjs <lang> <index> <from> <to>
 * Environment: TIER (telephone), PRESET (male).
 * Unlicense.
 */
import { synthesize } from '../src/index.js';
import { hmmAudio, hmmStatics } from '../src/recognition/hmm-features.js';
import { sentences } from '../tests/helpers/roundtrip.js';
import { frameLabels } from './issue-75-hmm-lib.mjs';

const [lang, index, from, to] = process.argv.slice(2);
const spoken = synthesize(sentences[lang][Number(index)], {
  lang,
  tier: process.env.TIER ?? 'telephone',
  preset: process.env.PRESET ?? 'male',
  head: 'random',
  seed: 1,
});
const { statics } = hmmStatics(hmmAudio(spoken.samples, spoken.sampleRate));
const { labels } = frameLabels(spoken.plan, statics.length);
const dB = 10 / Math.LN10;
for (let t = Number(from); t <= Number(to); t++) {
  const v = statics[t];
  console.log(
    String(t).padStart(4),
    (labels[t] ?? '').padEnd(5),
    `c0 ${(v[0] * dB).toFixed(1).padStart(6)} dB`,
    `c1 ${v[1].toFixed(2).padStart(6)}`,
    `c2 ${v[2].toFixed(2).padStart(6)}`,
    `voicing ${v[14].toFixed(2)}`
  );
}
