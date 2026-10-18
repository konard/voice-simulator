// Round-trip smoke test of every container and bit depth (issue 5).
// Run: node experiments/issue-5-audio-smoke.mjs
import { encodeWav, decodeWav } from '../src/audio/wav.js';
import { encodeAiff, decodeAiff } from '../src/audio/aiff.js';
import { encodeAu, decodeAu } from '../src/audio/au.js';
import { encodeFlac, decodeFlac } from '../src/audio/flac.js';

const rate = 22050;
const n = 10001;
const s = Float32Array.from(
  { length: n },
  (_, i) =>
    0.6 * Math.sin(i / 7) + 0.2 * Math.sin(i / 1.3) + (i % 97 === 0 ? 0.1 : 0)
);
const r = Float32Array.from(s, (v) => -v * 0.5);
const err = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const codecs = [
  ['wav', encodeWav, decodeWav],
  ['aiff', encodeAiff, decodeAiff],
  ['au', encodeAu, decodeAu],
  ['flac', encodeFlac, decodeFlac],
];
const depths = [
  { bitDepth: 8 },
  { bitDepth: 16 },
  { bitDepth: 24 },
  { bitDepth: 32 },
  { float: true },
  { float: true, bitDepth: 64 },
];
for (const [name, enc, dec] of codecs) {
  for (const opts of depths) {
    let bytes;
    try {
      bytes = enc(s, rate, opts);
    } catch (error) {
      console.log(name, JSON.stringify(opts), 'not supported:', error.message);
      continue;
    }
    const started = globalThis.performance.now();
    const d = dec(bytes);
    const ms = globalThis.performance.now() - started;
    const again = enc(d.samples, d.sampleRate, opts);
    const same =
      again.length === bytes.length && again.every((v, i) => v === bytes[i]);
    const st = dec(enc([s, r], rate, opts));
    const mix = Float32Array.from(s, (v, i) => (v + r[i]) / 2);
    console.log(
      name,
      JSON.stringify(opts),
      `bytes=${bytes.length} rate=${d.sampleRate} n=${d.samples.length}`,
      `err=${err(s, d.samples).toExponential(2)} reencode-identical=${same}`,
      `stereo-err=${err(mix, st.samples).toExponential(2)} ch=${st.channels}`,
      `decode=${ms.toFixed(1)}ms`
    );
  }
}
