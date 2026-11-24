/**
 * Pitch statics of a sentence next to its reference units with tones:
 * per frame the label, state, 4·log2 f0 (minus the median) and voicing.
 * node experiments/issue-75-tone-track.mjs [lang] [index] [tier] [preset]
 * Unlicense.
 */
import { synthesize } from '../src/index.js';
import { hmmAudio, hmmStatics } from '../src/recognition/hmm-features.js';
import { sentences } from '../tests/helpers/roundtrip.js';
import { frameLabels } from './issue-75-hmm-lib.mjs';

const [lang = 'zh', index = '1', tier = 'telephone', preset = 'male'] =
  process.argv.slice(2);
const spoken = synthesize(sentences[lang][Number(index)], {
  lang,
  tier,
  preset,
  head: 'random',
  seed: 1,
});
const { statics } = hmmStatics(hmmAudio(spoken.samples, spoken.sampleRate));
const { labels, states } = frameLabels(spoken.plan, statics.length, {
  tones: lang === 'zh',
});
console.log(spoken.ipa);
statics.forEach((v, t) => {
  console.log(
    `${String(t).padStart(4)} ${labels[t].padEnd(8)} ${states[t]} ${v[13].toFixed(2).padStart(6)} ${v[14].toFixed(2)}`
  );
});
