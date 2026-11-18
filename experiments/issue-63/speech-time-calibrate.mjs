// Unlicense. Measured speech seconds of default-head renders versus the
// articulated duration of the synthesizer's own plan (issue 63). Prints the
// two constants of SPEECH_TIME in src/analysis/voice-fit-calibration.js and
// the leave-one-text-out residuals.
import { synthesize } from '../../src/synthesize.js';
import { prepareLegacyVoice } from '../../src/analysis/voice-features.js';
import { plannedSpeechTime } from '../../src/analysis/voice-fit-transcript.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const TEXTS = [
  MATCH_TEXT,
  'The north wind and the sun.',
  'The north wind and the sun were disputing which was the stronger.',
  'The north wind and the sun were disputing which was the stronger, when a traveler came along wrapped in a warm cloak.',
];
const rows = [];
for (const [index, text] of TEXTS.entries()) {
  for (const speechRate of [0.8, 1, 1.25]) {
    const { samples } = synthesize(text, {
      head: { speechRate },
      seed: 1,
      sampleRate: 16000,
      solver: 'waveguide',
      engine: 'js',
    });
    const legacy = prepareLegacyVoice(Float32Array.from(samples), 16000, {
      diagnosticsOnly: true,
    }).rateFeatures;
    rows.push({
      index,
      speechRate,
      planned: plannedSpeechTime(text, speechRate),
      measured: legacy.activeDuration + 0.03,
    });
  }
}
const fit = (data) => {
  const n = data.length,
    sx = data.reduce((s, r) => s + r.planned, 0),
    sy = data.reduce((s, r) => s + r.measured, 0);
  const sxx = data.reduce((s, r) => s + r.planned ** 2, 0),
    sxy = data.reduce((s, r) => s + r.planned * r.measured, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return [slope, (sy - slope * sx) / n];
};
const [slope, offset] = fit(rows);
console.log(JSON.stringify({ slope, offset }));
for (const r of rows) {
  const [a, b] = fit(rows.filter((x) => x.index !== r.index));
  console.log(
    JSON.stringify({
      ...r,
      residual: (slope * r.planned + offset) / r.measured - 1,
      heldOut: (a * r.planned + b) / r.measured - 1,
    })
  );
}
