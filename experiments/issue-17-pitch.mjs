#!/usr/bin/env node

/**
 * Experiment for issue 17: print the pitch contour of every syllable in a
 * stretch of a recording, to check without listening that a Mandarin cut
 * holds the couplet of the text (the four tones have distinct contours).
 *
 *   node experiments/issue-17-pitch.mjs <file.wav> <start> <end>
 *
 * Pitch: normalised autocorrelation of 40 ms frames every 10 ms, 70-400 Hz,
 * voiced when the peak is above 0.5 and the frame is within 30 dB of the
 * loudest frame of the stretch. Syllables: runs of voiced frames split at
 * dips of the intensity of at least 3 dB. For each syllable the pitch at
 * 20 %, 50 % and 80 % of its length is printed in semitones above the
 * median of the stretch, with a tone guess: H (high level), R (rising),
 * L (low or dipping) and F (falling).
 */

import { readFileSync } from 'node:fs';

import { decodeWav } from '../src/audio/wav.js';

const [wavFile, startText, endText] = process.argv.slice(2);
const { samples, sampleRate } = decodeWav(readFileSync(wavFile));
const from = Math.round(Number(startText) * sampleRate);
const to = Math.round(Number(endText) * sampleRate);
const signal = samples.subarray(from, to);

const hop = Math.round(0.01 * sampleRate);
const win = Math.round(0.04 * sampleRate);
const minLag = Math.floor(sampleRate / 400);
const maxLag = Math.ceil(sampleRate / 70);

function frameAt(f) {
  const start = f * hop;
  let energy = 0;
  for (let i = start; i < start + win; i++) {
    energy += signal[i] * signal[i];
  }
  let best = 0;
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let a = 0;
    let b = 0;
    for (let i = start; i < start + win - lag; i++) {
      sum += signal[i] * signal[i + lag];
      a += signal[i] * signal[i];
      b += signal[i + lag] * signal[i + lag];
    }
    const r = sum / Math.sqrt(a * b + 1e-20);
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return {
    db: 10 * Math.log10(energy / win + 1e-20),
    r: best,
    f0: bestLag ? sampleRate / bestLag : 0,
  };
}

const frames = [];
for (let f = 0; f * hop + win + maxLag < signal.length; f++) {
  frames.push(frameAt(f));
}
const loudest = Math.max(...frames.map((x) => x.db));
for (const frame of frames) {
  frame.voiced = frame.r > 0.5 && frame.db > loudest - 30;
}
// Remove octave jumps against the median of the voiced frames.
const voicedF0 = frames.filter((x) => x.voiced).map((x) => x.f0);
const median = voicedF0.sort((a, b) => a - b)[Math.floor(voicedF0.length / 2)];
for (const frame of frames) {
  if (frame.voiced && frame.f0 > median * 1.7) {
    frame.f0 /= 2;
  } else if (frame.voiced && frame.f0 < median / 1.7) {
    frame.f0 *= 2;
  }
  frame.st = 12 * Math.log2(frame.f0 / median);
}

// Syllables: voiced runs, split at intensity dips of 3 dB or more.
const syllables = [];
let run = [];
const flush = () => {
  if (run.length >= 5) {
    syllables.push(run);
  }
  run = [];
};
for (let f = 0; f < frames.length; f++) {
  if (!frames[f].voiced) {
    flush();
    continue;
  }
  run.push(f);
  // Split when this frame is a local intensity minimum 3 dB under both
  // the highest frames before and after it within the run window.
  if (run.length >= 8) {
    const db = (k) => frames[k]?.db ?? -Infinity;
    const before = Math.max(...run.slice(0, -1).map(db));
    let after = -Infinity;
    for (let k = f + 1; k < Math.min(frames.length, f + 15); k++) {
      if (!frames[k].voiced) {
        break;
      }
      after = Math.max(after, db(k));
    }
    if (db(f) < before - 3 && db(f) < after - 3 && db(f) <= db(f + 1)) {
      run.pop();
      flush();
      run.push(f);
    }
  }
}
flush();

const at = (syllable, share) =>
  frames[syllable[Math.floor(share * (syllable.length - 1))]].st;
console.log(`# median ${median.toFixed(0)} Hz, ${syllables.length} syllables`);
const guesses = [];
for (const syllable of syllables) {
  const [a, b, c] = [at(syllable, 0.2), at(syllable, 0.5), at(syllable, 0.8)];
  const slope = c - a;
  const level = (a + b + c) / 3;
  let tone = 'H';
  if (slope >= 2) {
    tone = 'R';
  } else if (slope <= -2.5) {
    tone = level < -2 ? 'L' : 'F';
  } else if (level < -1.5) {
    tone = 'L';
  }
  guesses.push(tone);
  const time = ((from + syllable[0] * hop) / sampleRate).toFixed(2);
  console.log(
    `${time} ${(syllable.length / 100).toFixed(2)}s ${a.toFixed(1)} ${b.toFixed(1)} ${c.toFixed(1)} ${tone}`
  );
}
console.log(guesses.join(''));
