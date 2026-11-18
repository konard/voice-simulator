/** Scaled acoustic objective and cached aligned MCD. Unlicense, issue 63. */
import { powerFrames, cepstra } from '../metrics/spectrum.js';
import { dtw } from '../metrics/dtw.js';
import { normalizeRms, silentFrames } from '../metrics/distortion.js';
import {
  stateFeatures,
  histogramCount,
  quantile,
} from './voice-fit-statistics.js';
import {
  TEXT_FORMANT_WEIGHT,
  TEXT_SYLLABLE_RATIO,
} from './voice-fit-calibration.js';
export function featureVector(state) {
  const f = stateFeatures(state),
    log = (x) => (x > 0 ? Math.log(x) : null);
  const values = [
    log(f.f0),
    f.f0Range,
    log(f.formantSpacing),
    ...f.formants.slice(0, 3).map(log),
    ...['rd', 'h1h2Source', 'cpp', 'hnr'].map((k) =>
      histogramCount(state, k) ? quantile(state, k) : null
    ),
    state.voicedFrames ? state.tilt / state.voicedFrames : null,
    log(f.syllableRate),
  ];
  const scales = [0.03, 1.5, 0.02, 0.05, 0.05, 0.05, 0.3, 2, 1.5, 2, 3, 0.08];
  // analyzeFrames stores ln(power); the objective's mel scale is in dB.
  const mel = state.mel.map(
    (x) => (10 * x) / Math.LN10 / Math.max(1, state.voicedFrames)
  );
  const mean = mel.reduce((a, b) => a + b, 0) / 24;
  return {
    values: [...values, ...mel.map((x) => x - mean)],
    scales: [...scales, ...Array(24).fill(3)],
    speechTime: log(state.speechSeconds),
  };
}
// Index of ln(syllable rate) in featureVector values.
const RATE = 11;
// Without a transcript the target and the candidate say different words:
// the mel spectrum (indices 12 on) and the formants (2 to 5: dF, F1 to F3)
// depend on them.
function termWeight(i, transcript) {
  if (transcript) {
    return 1;
  }
  if (i >= 12) {
    return 0.3;
  }
  return i >= 2 && i <= 5 ? TEXT_FORMANT_WEIGHT : 1;
}
export function vectorDistance(
  target,
  candidate,
  transcript = false,
  mcd = null
) {
  let sum = 0,
    weight = 0;
  // With a transcript both say the same syllables, so their syllable rates
  // differ by the speaking time alone. The landmark count of one short
  // sentence moves by two nuclei between near-identical renders
  // (experiments/issue-63/rate-terms.txt), the speaking time by 3 %.
  const timed =
    transcript &&
    Number.isFinite(target.speechTime) &&
    Number.isFinite(candidate.speechTime);
  target.values.forEach((value, i) => {
    let x = value,
      y = candidate.values[i];
    // Without a transcript the candidate says MATCH_TEXT: the target's
    // syllable rate as MATCH_TEXT at the same speechRate would read.
    if (!transcript && i === RATE && x !== null) {
      x -= Math.log(TEXT_SYLLABLE_RATIO);
    }
    if (timed && i === RATE) {
      x = -target.speechTime;
      y = -candidate.speechTime;
    }
    if (
      x === null ||
      y === null ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return;
    }
    const w = termWeight(i, transcript);
    sum += w * ((y - x) / target.scales[i]) ** 2;
    weight += w;
  });
  if (transcript && !Number.isFinite(mcd)) {
    return Infinity;
  }
  if (transcript) {
    sum += 4 * mcd ** 2;
    weight += 4;
  }
  return weight ? Math.sqrt(sum / weight) : Infinity;
}

function prepare(samples, rate) {
  const power = powerFrames(normalizeRms(samples), rate);
  return { cepstra: cepstra(power, rate), silent: silentFrames(power) };
}
/** Same normalization, silence mask and formula as melCepstralDistortion;
 * retain the target spectra once for every search for repeated comparisons. */
export function createMcdMetric(recording, rate) {
  const target = prepare(recording, rate),
    a = target.cepstra.map((c) => c.subarray(1));
  return (render) => {
    const candidate = prepare(render, rate),
      b = candidate.cepstra.map((c) => c.subarray(1));
    if (!a.length || !b.length) {
      return Infinity;
    }
    const { path } = dtw(a, b, { band: 0.25 });
    let sum = 0,
      count = 0;
    for (const [i, j] of path) {
      if (target.silent[i]) {
        continue;
      }
      let squared = 0;
      for (let k = 0; k < a[i].length; k++) {
        squared += (a[i][k] - b[j][k]) ** 2;
      }
      sum += (10 / Math.LN10) * Math.sqrt(2 * squared);
      count++;
    }
    return count ? sum / count : 0;
  };
}
export function alignedMcd(recording, render, sampleRate) {
  return createMcdMetric(recording, sampleRate)(render);
}
