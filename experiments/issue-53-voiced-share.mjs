// Plain vs whispered `Please call Stella.`: the share of voiced frames and
// of noisy frames (YIN aperiodicity) for several level thresholds of the
// frames that count as signal (issue 53). Usage:
//   node experiments/issue-53-voiced-share.mjs
import { synthesize, levelDb } from '../src/index.js';
import { ANALYSIS_RATE, resample, yinPitch, percentile } from '../src/analysis/voice-features.js';

const TEXT = 'Please call Stella.';
const BASE = { tier: 'medium', seed: 1, markup: true, headroom: 20 };
for (const [name, text] of [['plain', TEXT], ['whisper', `[whisper]${TEXT}[/whisper]`]]) {
  const { samples, sampleRate } = synthesize(text, BASE);
  const { samples: signal, sampleRate: rate } = resample(samples, sampleRate, Math.min(sampleRate, ANALYSIS_RATE));
  const length = Math.round(0.03 * rate);
  const hop = Math.round(0.01 * rate);
  const frames = [];
  for (let start = 0; start + length <= signal.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + length; i++) sum += signal[i] ** 2;
    frames.push({ level: Math.sqrt(sum / length), ap: yinPitch(signal, start, length, rate).aperiodicity });
  }
  const top = percentile(frames.map((f) => f.level), 0.95);
  for (const share of [0.1, 0.2, 0.3, 0.5]) {
    const kept = frames.filter((f) => f.level > share * top);
    const voiced = kept.filter((f) => f.ap < 0.2).length / kept.length;
    const noisy = kept.filter((f) => f.ap > 0.4).length / kept.length;
    console.log(name.padEnd(8), `share ${share} (${(20 * Math.log10(share)).toFixed(0)} dB)`, 'frames', kept.length, 'voiced', voiced.toFixed(3), 'ap>0.4', noisy.toFixed(3), 'level', levelDb(samples).toFixed(1));
  }
}
