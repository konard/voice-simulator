// Unlicense. Stage A breathiness of varied heads after the CPP table (issue 63).
import { synthesize, fitVoice } from '../../src/index.js';
const text = process.argv[2] ?? 'The north wind and the sun.';
for (const base of [
  {},
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
  { pitch: 118, tenseness: 0.62, vocalTractLength: 17.2 },
]) {
  const row = [];
  for (const breathiness of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const { samples } = synthesize(text, {
      head: { ...base, breathiness },
      seed: 1,
      sampleRate: 16000,
      solver: 'waveguide',
      engine: 'js',
    });
    const r = fitVoice(samples, 16000, { refine: false });
    row.push(
      `${breathiness}->${r.head.breathiness.toFixed(2)}±${r.parameters.breathiness.sd.toFixed(2)}`
    );
  }
  console.log(JSON.stringify(base), row.join(' '));
}
