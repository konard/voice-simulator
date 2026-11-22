/**
 * Render training utterances for the HMM probe.
 * node experiments/issue-75-hmm-gen.mjs <lang> <count> <firstSeed> <tier> <out.bin>
 * Voices: random heads of the presets any, male, female, child by seed.
 * Env WHISPER=1 (or 0.5 for half) wraps sentences in whisper markup.
 * Env PITCH=1 adds pitch statics (30 dims) and zh tone units; the 8 kHz
 * audio is kept as base64 Int16 in "audio".
 * Unlicense.
 */
import { writeFileSync } from 'node:fs';
import { synthesize } from '../src/index.js';
import {
  createRandom,
  features,
  frameLabels,
  modelAudio,
  tokenUnits,
  sampleSentence,
} from './issue-75-hmm-lib.mjs';

const [lang, count = '50', first = '1000', tier = 'telephone', out] =
  process.argv.slice(2);
const presets = ['any', 'male', 'female', 'child'];
const pitch = process.env.PITCH === '1';
// WHISPER=1 renders whole whispered sentences, WHISPER=0.5 every other one.
const whisper = Number(process.env.WHISPER ?? 0);
const items = [];
let seconds = 0;
for (let i = 0; i < Number(count); i++) {
  const seed = Number(first) + i;
  const random = createRandom(`hmm-${lang}-${seed}`);
  const text = sampleSentence(lang, random);
  let spoken;
  try {
    const whispered = whisper > 0 && (whisper >= 1 || seed % 2 === 0);
    spoken = synthesize(whispered ? `[whisper]${text}[/whisper]` : text, {
      lang,
      markup: whispered,
      tier,
      head: 'random',
      preset: presets[seed % 4],
      seed,
    });
  } catch (error) {
    console.error('skip', text, error.message);
    continue;
  }
  const f = features(spoken.samples, spoken.sampleRate, { pitch });
  const tones = pitch && lang === 'zh';
  const { labels, states } = frameLabels(spoken.plan, f.length, { tones });
  const x = modelAudio(spoken.samples, spoken.sampleRate);
  const pcm = Int16Array.from(x, (v) =>
    Math.max(-32768, Math.min(32767, Math.round(v * 32767)))
  );
  seconds += spoken.duration;
  items.push({
    text,
    frames: f.length,
    units: tokenUnits(spoken.plan, { tones }),
    labels,
    states: [...states],
    feats: Buffer.from(
      new Float32Array(f.flatMap((v) => [...v])).buffer
    ).toString('base64'),
    ...(pitch && { audio: Buffer.from(pcm.buffer).toString('base64') }),
  });
}
writeFileSync(out, JSON.stringify(items));
console.log(lang, tier, items.length, 'utterances', seconds.toFixed(1), 's');
