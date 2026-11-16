// Voiced and voiceless consonants in a whisper (issue 53): the closure
// and burst of [p] against [b], the duration and level of [s] against
// [z], the whispered vowel of `ˈhḁ`. Usage:
//   node experiments/issue-53-contrasts.mjs [tier]
import { synthesize, levelDb, voicedShare } from '../src/index.js';

const tier = process.argv[2] ?? 'medium';
const render = (text) =>
  synthesize(text, { tier, seed: 1, ipa: true, headroom: 20 });
const consonant = (result) =>
  result.plan.segments.find((s) => s.kind === 'consonant' && s.token);
const at = (result, time) => Math.round(time * result.sampleRate);

const peakDb = (samples, from, to) => {
  let peak = 0;
  for (let i = from; i < to; i++) {
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  return 20 * Math.log10(peak);
};

/**
 * Peak (dB) of the burst: the 15 ms from the acoustic release, the first
 * millisecond after the quietest one of the closure that comes within
 * 50 dB of the peak of the whole sound (the plan's closure ends when the
 * lips are open, some 15 ms after the release).
 */
function burstPeak(result) {
  const closure = consonant(result);
  const ms = at(result, 0.001);
  const top = peakDb(result.samples, 0, result.samples.length);
  let quiet = Infinity;
  let release = 0;
  for (
    let i = at(result, closure.start);
    i < at(result, closure.end);
    i += ms
  ) {
    const level = peakDb(result.samples, i, i + ms);
    if (level < quiet) {
      [quiet, release] = [level, i];
    }
  }
  while (peakDb(result.samples, release, release + ms) < top - 50) {
    release += ms;
  }
  return peakDb(result.samples, release, release + at(result, 0.015));
}

const p = render('{W ˈapa W}');
const b = render('{W ˈaba W}');
const pc = consonant(p);
const bc = consonant(b);
console.log(
  'closure p',
  Math.round(1000 * (pc.end - pc.start)),
  'b',
  Math.round(1000 * (bc.end - bc.start)),
  'ms;',
  'burst p',
  burstPeak(p).toFixed(1),
  'b',
  burstPeak(b).toFixed(1),
  'dB'
);
const s = render('{W ˈasa W}');
const z = render('{W ˈaza W}');
const sc = consonant(s);
const zc = consonant(z);
const level = (result, segment) =>
  levelDb(result.samples, at(result, segment.start), at(result, segment.end));
console.log(
  'fricative s',
  Math.round(1000 * (sc.end - sc.start)),
  'z',
  Math.round(1000 * (zc.end - zc.start)),
  'ms;',
  's',
  level(s, sc).toFixed(1),
  'z',
  level(z, zc).toFixed(1),
  'dB'
);
const h = render('ˈhḁ');
const vowel = h.plan.segments.find((x) => x.kind === 'vowel');
const part = h.samples.subarray(at(h, vowel.start), at(h, vowel.end));
console.log(
  'hḁ vowel',
  level(h, vowel).toFixed(1),
  'dB, voicedShare',
  voicedShare(part, h.sampleRate).toFixed(3),
  'whole',
  voicedShare(h.samples, h.sampleRate).toFixed(3)
);
