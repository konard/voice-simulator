// Unlicense. Head A pitch SD with MAD taken in Hz versus in the f0
// histogram's own quarter-semitone units (issue 63 uncertainty gate).
import { synthesize } from '../../src/index.js';
import { fitVoice } from '../../src/analysis/voice-fit.js';
import {
  quantile,
  medianSd,
  histogramCount,
} from '../../src/analysis/voice-fit-statistics.js';
const heads = [
  { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
];
for (const head of heads) {
  const { samples } = synthesize('The north wind and the sun.', {
    head,
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
  const { state } = fitVoice(samples, 16000, { refine: false });
  const bins = state.histograms.f0,
    n = histogramCount(state, 'f0');
  const values = [];
  bins.forEach((c, i) => {
    for (let k = 0; k < c; k++) {
      values.push(i);
    }
  });
  const med = (v) => {
    const s = [...v].sort((a, b) => a - b),
      at = (s.length - 1) / 2;
    return (s[Math.floor(at)] + s[Math.ceil(at)]) / 2;
  };
  const m = med(values),
    mad = med(values.map((v) => Math.abs(v - m)));
  const f0 = quantile(state, 'f0');
  const sdIndex = (1.4826 * mad) / Math.sqrt(n / 20);
  console.log(
    JSON.stringify({
      pitch: head.pitch,
      frames: n,
      medianHz: f0,
      sdHz: medianSd(state, 'f0'),
      madQuarterSemitones: mad,
      sdLogDomainHz: f0 * (Math.LN2 / 48) * sdIndex,
    })
  );
}
