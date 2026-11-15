// Pitch track of a pulse train gliding from 100 to 200 Hz over 1 s (issue 18):
// median relative error and unvoiced frames for a raw single-sample pulse
// train and for the same train smoothed by two one-pole low-pass filters
// (a glottal-like -12 dB/octave tilt), with 0.04 s and 0.025 s windows.
// Run: node experiments/issue-18-glide.mjs
import { pitchTrack } from '../src/index.js';

const sampleRate = 16000;
const truth = (seconds) => 100 + 100 * seconds;

function pulses() {
  const samples = new Float64Array(sampleRate);
  let phase = 0;
  for (let index = 0; index < samples.length; index++) {
    const previous = phase;
    phase += truth(index / sampleRate) / sampleRate;
    if (Math.floor(phase) > Math.floor(previous)) {
      samples[index] = 1;
    }
  }
  return samples;
}

function smooth(samples, pole) {
  const out = new Float64Array(samples.length);
  let a = 0;
  let b = 0;
  for (let index = 0; index < samples.length; index++) {
    a = samples[index] + pole * a;
    b = a + pole * b;
    out[index] = b;
  }
  return out;
}

function score(samples, window) {
  const track = pitchTrack(samples, sampleRate, { window });
  const errors = [];
  track.forEach((f0, frame) => {
    const centre = frame * 0.01 + window / 2;
    if (centre < 0.98) {
      errors.push(f0 > 0 ? Math.abs(f0 / truth(centre) - 1) : 1);
    }
  });
  const sorted = errors.sort((x, y) => x - y);
  const voiced = sorted.filter((e) => e < 1);
  return {
    median: sorted[sorted.length >> 1].toFixed(4),
    unvoiced: errors.length - voiced.length,
    frames: errors.length,
    voicedMedian: voiced.length ? voiced[voiced.length >> 1].toFixed(4) : 'n/a',
  };
}

for (const [name, signal] of [
  ['raw', pulses()],
  ['smoothed 0.9', smooth(pulses(), 0.9)],
  ['smoothed 0.95', smooth(pulses(), 0.95)],
]) {
  for (const window of [0.04, 0.025]) {
    console.log(name, window, JSON.stringify(score(signal, window)));
  }
}
