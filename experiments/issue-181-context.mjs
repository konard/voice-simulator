// Issue 181: acoustic score of readings of "Hello world." with in-word
// phone contexts and with context-independent phones (each phone its own
// word, so no context state applies). Unlicense.
import { synthesize } from '../src/index.js';
import { resample } from '../src/audio/resample.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { alignWords } from '../src/recognition/hmm-decode.js';

const model = getHmmModel();
const network = getNetwork(model, ['en'], {});
const word = (s) => {
  const tokens = s.split(' ').map((symbol) => ({ symbol, kind: 'x' }));
  return { word: s, tokens, units: tokens.map((t) => t.symbol) };
};
const READINGS = {
  hello: ['h ə l o ʊ', 'w ɝ l d'],
  herno: ['h ɚ', 'n o ʊ', 'w ɝ l d'],
  tono: ['t ɪ', 'n o ʊ', 'w ɝ l d'],
};
const score = (feats, frames, tone, words) => {
  let acoustic = -Infinity;
  const aligned = alignWords(network, feats, frames, words, {
    tone,
    onScore: (s) => (acoustic = s),
  });
  return { acoustic, aligned };
};
for (const tier of (process.argv[2] ?? 'telephone,wideband,default').split(
  ','
)) {
  const out = synthesize('Hello world.', {
    tier: tier === 'default' ? undefined : tier,
    lang: 'en',
    seed: 1,
  });
  const rate = Math.min(out.sampleRate, 8000);
  const input =
    rate < out.sampleRate
      ? resample(out.samples, out.sampleRate, rate)
      : out.samples;
  const { feats, frames, tone } = hmmFeatures(input, rate, model.lda);
  console.log(tier, 'frames', frames);
  for (const [name, reading] of Object.entries(READINGS)) {
    const ctx = score(feats, frames, tone, reading.map(word));
    const ci = score(
      feats,
      frames,
      tone,
      reading.flatMap((w) => w.split(' ')).map(word)
    );
    const spans = ctx.aligned
      .map((a) => `${a.token.symbol}:${a.from}-${a.to}`)
      .join(' ');
    console.log(
      `  ${name.padEnd(6)} context ${ctx.acoustic.toFixed(1)} ci ${ci.acoustic.toFixed(1)}  ${spans}`
    );
  }
}
