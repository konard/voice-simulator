// Quick measures of plain vs whispered speech (issue 53). Usage:
//   node experiments/issue-53-quick.mjs [tier]
import { performance } from 'node:perf_hooks';
import {
  synthesize,
  levelDb,
  voicedShare,
  energyRatio,
  centreOfGravity,
  analyzeVoice,
  frameAperiodicities,
} from '../src/index.js';

const tier = process.argv[2] ?? 'medium';
const TEXT = 'Please call Stella.';
const BASE = { tier, seed: 1, markup: true, headroom: 20 };
const cases = [
  ['plain', TEXT],
  ['whisper', `[whisper]${TEXT}[/whisper]`],
  ['soft', `[whisper][soft]${TEXT}[/soft][/whisper]`],
  ['loud', `[whisper][loud]${TEXT}[/loud][/whisper]`],
  ['whispery', `{Ṿ ˈama Ṿ}`, { ipa: true, markup: false }],
  ['ama', `ˈama`, { ipa: true, markup: false }],
];
for (const [name, text, extra] of cases) {
  const started = performance.now();
  const r = synthesize(text, { ...BASE, ...extra });
  const { samples, sampleRate } = r;
  const ap = frameAperiodicities(samples, sampleRate);
  const noisy = ap.filter((v) => v > 0.4).length / Math.max(1, ap.length);
  const v = analyzeVoice(samples, sampleRate);
  console.log(
    name.padEnd(9),
    'level',
    levelDb(samples).toFixed(1),
    'voiced',
    voicedShare(samples, sampleRate).toFixed(3),
    'ap>0.4',
    noisy.toFixed(3),
    'hnr',
    v.hnr.toFixed(1),
    'ER',
    energyRatio(samples, sampleRate).toFixed(1),
    'CoG',
    centreOfGravity(samples, sampleRate).toFixed(0),
    'dur',
    r.plan.duration.toFixed(3),
    'engine',
    r.engine ?? r.renderer?.engine ?? '',
    `${((performance.now() - started) / 1000).toFixed(1)}s`
  );
}
