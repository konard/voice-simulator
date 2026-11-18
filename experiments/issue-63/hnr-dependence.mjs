// Unlicense. Median inverse-filter HNR of renders that vary one head
// parameter at a time at breathiness 0.2 (issue 63 source bias probe).
import { synthesize } from '../../src/synthesize.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';
const text = process.argv[2] ?? 'The north wind and the sun.';
const median = (v) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const variants = [
  {},
  { pitch: 100 },
  { pitch: 160 },
  { pitch: 210 },
  { tenseness: 0.75 },
  { tenseness: 0.45 },
  { speechRate: 0.9 },
  { vocalTractLength: 18.5 },
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
];
for (const v of variants) {
  for (const breathiness of [0.2, 0.6]) {
    const head = { ...v, breathiness };
    const { samples } = synthesize(text, {
      head,
      seed: 1,
      sampleRate: 16000,
      solver: 'waveguide',
      engine: 'js',
    });
    const frames = analyzeFrames(Float32Array.from(samples), 16000);
    const pitch = trackPitch(frames);
    const src = inverseFilter(frames, { pitch });
    const vals = [],
      cpp = [];
    for (let t = 0; t < frames.count; t++) {
      if (pitch.f0[t] > 0 && src.reliable[t]) {
        vals.push(src.hnr[t]);
        cpp.push(src.cpp[t]);
      }
    }
    console.log(
      JSON.stringify(head),
      'n',
      vals.length,
      'hnr',
      median(vals).toFixed(2),
      'cpp',
      median(cpp).toFixed(2)
    );
  }
}
