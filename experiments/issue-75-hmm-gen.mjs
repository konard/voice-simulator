/**
 * Render training utterances for the HMM probe.
 * node experiments/issue-75-hmm-gen.mjs <lang> <count> <firstSeed> <tier> <out.bin>
 * Voices: random heads of the presets any, male, female, child by seed.
 * Unlicense.
 */
import { writeFileSync } from 'node:fs';
import { synthesize } from '../src/index.js';
import {
  createRandom,
  features,
  frameLabels,
  sampleSentence,
} from './issue-75-hmm-lib.mjs';

const [lang, count = '50', first = '1000', tier = 'telephone', out] =
  process.argv.slice(2);
const presets = ['any', 'male', 'female', 'child'];
const items = [];
let seconds = 0;
for (let i = 0; i < Number(count); i++) {
  const seed = Number(first) + i;
  const random = createRandom(`hmm-${lang}-${seed}`);
  const text = sampleSentence(lang, random);
  let spoken;
  try {
    spoken = synthesize(text, {
      lang,
      tier,
      head: 'random',
      preset: presets[seed % 4],
      seed,
    });
  } catch (error) {
    console.error('skip', text, error.message);
    continue;
  }
  const f = features(spoken.samples, spoken.sampleRate);
  const { labels, states } = frameLabels(spoken.plan, f.length);
  seconds += spoken.duration;
  items.push({
    text,
    frames: f.length,
    labels,
    states: [...states],
    feats: Buffer.from(
      new Float32Array(f.flatMap((v) => [...v])).buffer
    ).toString('base64'),
  });
}
writeFileSync(out, JSON.stringify(items));
console.log(lang, tier, items.length, 'utterances', seconds.toFixed(1), 's');
