/**
 * Issue 38: per-sound formants of the voice-match test sentence for the
 * female preset, as analyzeVoice() measures them (11025 Hz, LPC order 12,
 * 4 formants, 30 ms windows every 10 ms), in a given checkout. Prints the
 * median F1 to F4 and the formant spacing per sound of the plan, so that two
 * checkouts can be compared sound by sound.
 * Usage: node experiments/issue-38-formant-frames.mjs [root] [preset]
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const preset = process.argv[3] ?? 'female';
const load = (path) => import(pathToFileURL(`${root}/${path}`).href);
const { synthesize, presetHeadConfig } = await load('src/index.js');
const { estimateFormants } = await load('src/acoustics/analysis.js');
const { formantSpacing } = await load('src/analysis/voice-features.js');

const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const result = synthesize(TEXT, {
  head: presetHeadConfig(preset),
  solver: 'waveguide',
  sampleRate: 16000,
});
const rate = 16000;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
};
const all = [];
for (const segment of result.plan.segments) {
  const rows = [];
  for (let time = segment.start; time + 0.03 <= segment.end; time += 0.01) {
    const formants = estimateFormants(result.samples, rate, {
      start: time,
      duration: 0.03,
      count: 4,
      analysisRate: 11025,
      order: 12,
    });
    if (formants.length >= 3) {
      rows.push([...formants, formantSpacing(formants)]);
      all.push(formantSpacing(formants));
    }
  }
  if (!rows.length) {
    continue;
  }
  const columns = [0, 1, 2, 3, 4].map((index) =>
    Math.round(median(rows.map((row) => row[index] ?? NaN)))
  );
  console.log(
    `${String(segment.token?.symbol ?? segment.kind).padEnd(4)} ${String(rows.length).padStart(2)}  ${columns.map((value) => String(value).padStart(5)).join(' ')}`
  );
}
console.log('median spacing', Math.round(median(all)), 'frames', all.length);
