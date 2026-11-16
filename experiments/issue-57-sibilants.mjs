/**
 * Issue 57: the spectra of [ʂ] and [s] (是 and 四 in zh-CN), tier medium,
 * seed 1. Run: node experiments/issue-57-sibilants.mjs
 */

import { powerFrames } from '../src/metrics/spectrum.js';
import {
  consonants,
  renderAccent,
  segmentCentroid,
} from '../tests/helpers/accent-measures.js';

for (const text of ['是', '四', 'ˈaʂa', 'ˈasa', 'ˈaɕa', 'ˈaʃa']) {
  const ipa = /^[\p{Script=Han}]/u.test(text) ? null : text;
  const result = ipa
    ? (await import('../src/synthesize.js')).synthesize(ipa, {
        ipa: true,
        tier: 'medium',
        seed: 1,
      })
    : renderAccent(text, 'zh', 'zh-CN');
  const segment = consonants(result)[0];
  const { samples, sampleRate } = result;
  const span = segment.end - segment.start;
  const slice = samples.slice(
    Math.round((segment.start + 0.2 * span) * sampleRate),
    Math.round((segment.end - 0.2 * span) * sampleRate)
  );
  const frames = powerFrames(slice, sampleRate);
  const size = frames[0].length;
  const bands = [
    0, 1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 16000, 24000,
  ];
  const energy = bands.slice(1).map(() => 0);
  for (let bin = 0; bin < size; bin++) {
    const frequency = (bin * sampleRate) / (2 * (size - 1));
    const band = bands.findIndex(
      (edge, index) => frequency >= edge && frequency < bands[index + 1]
    );
    for (const frame of frames) {
      if (band >= 0) {
        energy[band] += frame[bin];
      }
    }
  }
  const total = energy.reduce((a, b) => a + b, 0);
  console.log(
    `${text} /${result.ipa}/ ${segment.token?.symbol} ${(span * 1000).toFixed(0)} ms, centroid ${segmentCentroid(result, segment).toFixed(0)} Hz: ${energy
      .map(
        (value, index) =>
          `${bands[index] / 1000}k ${(10 * Math.log10(value / total)).toFixed(0)}`
      )
      .join(' ')}`
  );
}
