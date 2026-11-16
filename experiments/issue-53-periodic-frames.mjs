// Frames of a whispered sentence that YIN still finds periodic
// (aperiodicity <= 0.4), with their time, level against the 95th
// percentile, YIN pitch and the segment there (issue 53). Usage:
//   node experiments/issue-53-periodic-frames.mjs [markup text] [tier]
import { synthesize } from '../src/index.js';
import {
  ANALYSIS_RATE,
  resample,
  yinPitch,
  percentile,
} from '../src/analysis/voice-features.js';

const text = process.argv[2] ?? '[whisper]Please call Stella.[/whisper]';
const tier = process.argv[3] ?? 'medium';
const result = synthesize(text, { tier, seed: 1, markup: true, headroom: 20 });
const { samples: signal, sampleRate: rate } = resample(
  result.samples,
  result.sampleRate,
  Math.min(result.sampleRate, ANALYSIS_RATE)
);
const length = Math.round(0.03 * rate);
const hop = Math.round(0.01 * rate);
const frames = [];
for (let start = 0; start + length <= signal.length; start += hop) {
  let sum = 0;
  for (let i = start; i < start + length; i++) {
    sum += signal[i] ** 2;
  }
  frames.push({
    time: start / rate,
    level: Math.sqrt(sum / length),
    yin: yinPitch(signal, start, length, rate),
  });
}
const top = percentile(
  frames.map((f) => f.level),
  0.95
);
const kept = frames.filter((f) => f.level > 0.1 * top);
const bad = kept.filter((f) => f.yin.aperiodicity <= 0.4);
console.log(
  `${bad.length} of ${kept.length} frames periodic (${(1 - bad.length / kept.length).toFixed(3)} noisy)`
);
for (const frame of bad) {
  const centre = frame.time + 0.015;
  const segment = result.plan.segments.find(
    (s) => s.start <= centre && centre < s.end
  );
  console.log(
    frame.time.toFixed(2),
    `${(20 * Math.log10(frame.level / top)).toFixed(1)} dB`,
    `ap ${frame.yin.aperiodicity.toFixed(2)}`,
    `f0 ${Math.round(frame.yin.f0 ?? frame.yin.frequency ?? 0)}`,
    segment
      ? `${segment.kind} ${segment.token?.symbol ?? segment.token?.text ?? ''}`
      : '-'
  );
}
