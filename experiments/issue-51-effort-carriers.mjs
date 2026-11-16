/**
 * Issue 51 after merging #52: the effort measurements of tests/effort.test.js
 * on the plain carriers, to see what the tunes change. Run on a checkout:
 *   node experiments/issue-51-effort-carriers.mjs [path to src/index.js]
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = process.argv[2] ?? path.join(here, '../src/index.js');
const vs = await import(pathToFileURL(path.resolve(entry)).href);
const { synthesize, levelDb, alphaRatio, analyzeVoice } = vs;
const BASE = { tier: 'medium', seed: 1, markup: true, headroom: 20 };
const st = (a, b) => 12 * Math.log2(a / b);

function measure(input, options = {}) {
  const { samples, sampleRate, plan } = synthesize(input, {
    ...BASE,
    ...options,
  });
  const voice = analyzeVoice(samples, sampleRate);
  return {
    level: levelDb(samples, 0, samples.length),
    alpha: alphaRatio(samples, sampleRate, 0, samples.length),
    f0: voice.f0,
    h1h2: voice.h1h2,
    f1: voice.formants[0],
    pitch: plan.channels?.pitch,
  };
}
const TEXT = 'Please call Stella.';
const plain = measure(TEXT);
for (const tag of ['soft', 'loud', 'shout']) {
  const m = measure(`[${tag}]${TEXT}[/${tag}]`);
  console.log(
    `${tag.padEnd(5)} level ${(m.level - plain.level).toFixed(2)} dB, alpha ${(m.alpha - plain.alpha).toFixed(2)} dB, f0 ${st(m.f0, plain.f0).toFixed(2)} st, h1h2 ${(m.h1h2 - plain.h1h2).toFixed(2)} dB`
  );
}
const ipa = { ipa: true, markup: false };
for (const source of ['lf', 'folds']) {
  const options = source === 'folds' ? { ...ipa, source } : ipa;
  const a = measure('ˈa', options);
  for (const text of ['ˈa', '{f ˈa f}', '{ff ˈa ff}']) {
    const m = measure(text, options);
    console.log(
      `${source.padEnd(5)} ${text.padEnd(10)} f0 ${m.f0.toFixed(1)} Hz (${st(m.f0, a.f0).toFixed(2)} st), F1 ${m.f1.toFixed(0)} Hz (${(m.f1 - a.f1).toFixed(0)})`
    );
  }
}
