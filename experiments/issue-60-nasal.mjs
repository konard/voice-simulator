// Calibration of the nasal flag of src/recognition/formants.js
// (NASAL_RATIO, NASAL_BAND_DROP and NASAL_HIGH_DROP): ama, ana, aŋa, imi,
// ini and unu, presets male, female and child, 16000 and 8000 Hz
// (waveguide, seed 1), tract length estimated (the default). Frames inside
// the nasal consonant of plan.segments should be flagged and frames inside
// the vowels not (frames within 10 ms of a segment edge are left out). For
// each ratio the tracker runs with both band thresholds at Infinity, which
// leaves the candidate half of the flag (lowest candidate below ratio
// ref[1] with a bandwidth below 200 Hz); the drops band[1] - band[0] and
// band[3] - band[1] of the frame set give the flag for every pair of
// thresholds from -30 to 0 dB. The chosen triple flags the most nasal
// frames while flagging at most 8 % of the vowel frames (the test
// `flags nasal murmurs` allows 10 %); ties go to the fewer vowel frames,
// then to the higher (looser) thresholds.
// Run: node experiments/issue-60-nasal.mjs > experiments/issue-60-nasal.txt
import {
  analyzeFrames,
  planUtterance,
  presetHeadConfig,
  renderPlan,
  trackFormants,
} from '../src/index.js';

const WORDS = ['ama', 'ana', 'aŋa', 'imi', 'ini', 'unu'];
const GUARD = 0.01;
const RATIOS = Array.from({ length: 26 }, (_, i) => 0.5 + 0.02 * i);
const DROPS = Array.from({ length: 31 }, (_, i) => -30 + i);
const VOWEL_LIMIT = 0.08;

const takes = [];
for (const preset of ['male', 'female', 'child']) {
  for (const rate of [16000, 8000]) {
    for (const word of WORDS) {
      const head = presetHeadConfig(preset);
      const plan = planUtterance(word, { head });
      const samples = renderPlan(plan, {
        head,
        solver: 'waveguide',
        sampleRate: rate,
        seed: 1,
      });
      takes.push({ word, plan, frames: analyzeFrames(samples, rate) });
    }
  }
}

let nasalFrames = 0;
let vowelFrames = 0;
let best = null;
const perRatio = [];
const better = (a, b) =>
  !b ||
  a.nasal > b.nasal ||
  (a.nasal === b.nasal &&
    (a.vowel < b.vowel ||
      (a.vowel === b.vowel && a.drop + a.high > b.drop + b.high)));
for (const ratio of RATIOS) {
  // counts[(i * DROPS.length + j) * 2 + (isNasal ? 0 : 1)]
  const counts = new Float64Array(DROPS.length * DROPS.length * 2);
  nasalFrames = 0;
  vowelFrames = 0;
  for (const { plan, frames } of takes) {
    const track = trackFormants(frames, {
      nasalBandDrop: Infinity,
      nasalHighDrop: Infinity,
      nasalRatio: ratio,
    });
    const bands = frames.band.length / frames.capacity;
    for (let t = 0; t < track.count; t++) {
      const time = track.startTime + t * track.hop;
      const segment = plan.segments.find(
        (item) => time >= item.start + GUARD && time < item.end - GUARD
      );
      if (!segment || segment.kind === 'pause') {
        continue;
      }
      const isNasal = segment.kind === 'consonant';
      if (isNasal) {
        nasalFrames++;
      } else {
        vowelFrames++;
      }
      if (track.nasal[t] !== 1) {
        continue;
      }
      const drop = frames.band[t * bands + 1] - frames.band[t * bands];
      const high = frames.band[t * bands + 3] - frames.band[t * bands + 1];
      DROPS.forEach((x, i) => {
        if (drop < x) {
          DROPS.forEach((y, j) => {
            if (high < y) {
              counts[(i * DROPS.length + j) * 2 + (isNasal ? 0 : 1)]++;
            }
          });
        }
      });
    }
  }
  let row = null;
  DROPS.forEach((x, i) => {
    DROPS.forEach((y, j) => {
      const item = {
        ratio,
        drop: x,
        high: y,
        nasal: counts[(i * DROPS.length + j) * 2] / nasalFrames,
        vowel: counts[(i * DROPS.length + j) * 2 + 1] / vowelFrames,
      };
      if (item.vowel <= VOWEL_LIMIT && better(item, row)) {
        row = item;
      }
      if (Math.abs(ratio - 0.6) < 1e-9 && x === -13 && y === 0) {
        perRatio.push({ ...item, note: 'issue ratio 0.60, no high test' });
      }
      if (Math.abs(ratio - 0.9) < 1e-9 && x === -13 && y === 0) {
        perRatio.push({ ...item, note: 'ratio 0.90, drop -13, no high test' });
      }
    });
  });
  if (row) {
    perRatio.push(row);
    if (better(row, best)) {
      best = row;
    }
  }
}

console.log(`frames: nasal ${nasalFrames}, vowel ${vowelFrames}`);
const show = (item) =>
  `ratio ${item.ratio.toFixed(2)} drop ${item.drop} dB high ${item.high} dB: ` +
  `nasal flagged ${item.nasal.toFixed(3)}, vowel flagged ${item.vowel.toFixed(3)}${
    item.note ? ` (${item.note})` : ''
  }`;
console.log(
  `best thresholds per ratio (vowel flagged at most ${VOWEL_LIMIT}):`
);
for (const item of perRatio) {
  console.log(`  ${show(item)}`);
}
console.log(`best: ${show(best)}`);
