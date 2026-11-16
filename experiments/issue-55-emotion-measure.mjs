// Measure every emotion preset against plain speech (issue 55).
// node experiments/issue-55-emotion-measure.mjs [text]
import { analyzeVoice, levelDb, synthesize } from '../src/index.js';

const TEXT = process.argv[2] ?? 'The train leaves at seven.';
const BASE = { tier: 'medium', seed: 1, markup: true, headroom: 20 };
const st = (f, r) => 12 * Math.log2(f / r);

function measure(input) {
  const result = synthesize(input, BASE);
  const { samples, sampleRate, plan } = result;
  const voice = analyzeVoice(samples, sampleRate);
  let stressed = 0;
  const vowels = plan.segments.filter((s) => s.kind === 'vowel');
  for (const s of vowels) {
    if (s.token.stress === 1) {
      stressed += s.duration;
    }
  }
  const last = vowels.at(-1);
  const f0 = plan.channels.f0;
  const a = Math.round(last.start * plan.frameRate);
  const b = Math.round(last.end * plan.frameRate) - 1;
  return {
    voice,
    level: levelDb(samples, 0, samples.length),
    duration: plan.duration,
    stressed,
    lastRise: st(f0[b], f0[a]),
    samples,
  };
}

const plain = measure(TEXT);
console.log(
  'plain',
  plain.voice.f0.toFixed(1),
  plain.voice.f0Range.toFixed(2),
  plain.duration.toFixed(3),
  plain.voice.h1h2.toFixed(2),
  plain.level.toFixed(1)
);
const names = process.argv[3]
  ? process.argv[3].split(',')
  : [
      'loud',
      'angry',
      'happy',
      'sad',
      'afraid',
      'bored',
      'surprised',
      'disgusted',
      'tender',
      'sarcastic',
      'confident',
      'hesitant',
    ];
for (const name of names) {
  const m = measure(`[${name}]${TEXT}[/${name}]`);
  console.log(
    name.padEnd(10),
    'f0',
    st(m.voice.f0, plain.voice.f0).toFixed(2),
    'range×',
    (m.voice.f0Range / plain.voice.f0Range).toFixed(2),
    'dur×',
    (m.duration / plain.duration).toFixed(2),
    'stress×',
    (m.stressed / plain.stressed).toFixed(2),
    'h1h2Δ',
    (m.voice.h1h2 - plain.voice.h1h2).toFixed(2),
    'levelΔ',
    (m.level - plain.level).toFixed(1),
    'lastRise',
    m.lastRise.toFixed(2),
    'F2',
    m.voice.formants?.[1]?.toFixed?.(0)
  );
}
