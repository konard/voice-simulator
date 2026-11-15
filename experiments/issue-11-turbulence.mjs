// Noise sources driven by the air flow (issue 35, roadmap issue 11):
//   1. [s ʃ f θ x z v] between [a]: noise level against the vowel, centre of
//      gravity and peak of the spectrum;
//   2. [pa ta ka pʰa tʰa kʰa ba]: times of the transient, the frication and
//      aspiration peaks and the voice onset after the release;
//   3. [s] at lungPressure 400, 800 and 1600 Pa.
// Tier medium: waveguide, 44 sections, 48 kHz, seed 1.
// Usage: node experiments/issue-11-turbulence.mjs > experiments/issue-11-turbulence.txt
import { planUtterance } from '../src/articulation/plan.js';
import { VoiceRenderer } from '../src/acoustics/voice.js';
import { rms } from '../src/acoustics/analysis.js';
import { fft } from '../src/metrics/spectrum.js';
import { Biquad } from '../src/acoustics/filters.js';
import { normalizeHeadConfig } from '../src/head-config.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The renderer of a copy of src/ without the burst transient
 * (TRANSIENT_GAIN 0): the solver is linear in its sources and the noise is
 * seeded, so this render holds the frication and aspiration alone.
 */
async function rendererWithoutTransient() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'turbulence-'));
  fs.cpSync(path.join(import.meta.dirname, '../src'), path.join(root, 'src'), {
    recursive: true,
  });
  const file = path.join(root, 'src/acoustics/voice.js');
  const source = fs.readFileSync(file, 'utf8');
  const patched = source.replace(
    /export const TRANSIENT_GAIN = [^;]+;/,
    'export const TRANSIENT_GAIN = 0;'
  );
  if (patched === source) {
    throw new Error('TRANSIENT_GAIN not found');
  }
  fs.writeFileSync(file, patched);
  const module = await import(pathToFileURL(file).href);
  fs.rmSync(root, { recursive: true, force: true });
  return module.VoiceRenderer;
}
const QuietRenderer = await rendererWithoutTransient();

const RATE = 48000;
const BLOCK = 32;
const decibels = (value) => 20 * Math.log10(value);

/**
 * Render a plan block by block and record the air flow of every control
 * block (time at the start of the block).
 */
function renderTrace(plan, head, Renderer = VoiceRenderer) {
  const renderer = new Renderer(plan, {
    sampleRate: RATE,
    seed: 1,
    head,
    blockSize: BLOCK,
  });
  const samples = new Float32Array(renderer.totalSamples);
  const trace = [];
  for (let start = 0; start < samples.length; start += BLOCK) {
    const time = start / RATE;
    renderer.render(samples.subarray(start, start + BLOCK));
    const { shape, airflow: air } = renderer;
    const { glottis, frication } = shape;
    trace.push({
      time,
      area: frication.area,
      voicing: glottis.voicing * (1 - glottis.closure),
      transient: Math.abs(air.flowDerivative),
      frication: renderer.fricationAmplitude,
      aspiration: glottis.aspiration * glottis.aspirationStrength,
    });
  }
  return { samples, trace };
}

/** Welch power spectrum (Hann, 1024 points, half overlap). */
function spectrum(samples, start, end, size = 1024) {
  const power = new Float64Array(size / 2 + 1);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let frames = 0;
  for (let from = start; from + size <= end; from += size / 2) {
    for (let index = 0; index < size; index++) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
      re[index] = samples[from + index] * window;
      im[index] = 0;
    }
    fft(re, im);
    for (let bin = 0; bin < power.length; bin++) {
      power[bin] += re[bin] ** 2 + im[bin] ** 2;
    }
    frames++;
  }
  return { power, binWidth: RATE / size, frames };
}

/**
 * Centre of gravity (Hz) between 500 Hz and 11 kHz and the peak of the
 * spectrum smoothed over 500 Hz between 1 and 11 kHz.
 */
function spectralShape({ power, binWidth }) {
  const low = Math.round(500 / binWidth);
  const high = Math.round(11000 / binWidth);
  let sum = 0;
  let moment = 0;
  for (let bin = low; bin <= high; bin++) {
    sum += power[bin];
    moment += power[bin] * bin * binWidth;
  }
  const half = Math.round(250 / binWidth);
  let peak = 0;
  let best = -1;
  for (let bin = Math.round(1000 / binWidth); bin <= high; bin++) {
    let smoothed = 0;
    for (let other = bin - half; other <= bin + half; other++) {
      smoothed += power[other];
    }
    if (smoothed > best) {
      best = smoothed;
      peak = bin * binWidth;
    }
  }
  return { centre: moment / sum, peak };
}

/** Fourth-order high-pass at 4 kHz (as tests/acoustics.test.js). */
function above4k(samples) {
  const first = new Biquad();
  const second = new Biquad();
  first.highpass(4000, Math.SQRT1_2, RATE);
  second.highpass(4000, Math.SQRT1_2, RATE);
  return Float32Array.from(samples, (sample) =>
    second.process(first.process(sample))
  );
}

/** Middle 60 % of a segment in samples. */
function middle(segment) {
  const span = segment.end - segment.start;
  return [
    Math.floor((segment.start + span * 0.2) * RATE),
    Math.floor((segment.end - span * 0.2) * RATE),
  ];
}

function fricatives() {
  console.log('1. Fricatives between [a] (noise level of the middle 60 %)');
  console.log(
    'word   level dB  against vowel dB  above 4 kHz dB  centre of gravity Hz  peak Hz'
  );
  for (const symbol of ['s', 'ʃ', 'f', 'θ', 'x', 'z', 'v']) {
    const ipa = `ˈa${symbol}a`;
    const plan = planUtterance(ipa, { language: 'en' });
    const { samples } = renderTrace(plan);
    const consonant = plan.segments.find((item) => item.kind === 'consonant');
    const vowel = plan.segments.find((item) => item.kind === 'vowel');
    const [start, end] = middle(consonant);
    const level = rms(samples, start, end);
    const against = level / rms(samples, ...middle(vowel));
    const { centre, peak } = spectralShape(spectrum(samples, start, end));
    console.log(
      `${ipa.padEnd(6)} ${decibels(level).toFixed(2).padStart(8)}  ` +
        `${decibels(against).toFixed(2).padStart(16)}  ` +
        `${decibels(rms(above4k(samples), start, end))
          .toFixed(2)
          .padStart(14)}  ` +
        `${centre.toFixed(0).padStart(20)}  ${peak.toFixed(0).padStart(7)}`
    );
  }
}

/**
 * Acoustic voice onset: start of the first 20 ms frame after `from` (1 ms
 * hops) from which on the normalised autocorrelation of the first
 * difference of the signal (which removes the slow flow of the transient)
 * reaches 0.6 at a lag of 1/300 to 1/70 s for 10 ms in a row.
 */
function voiceOnset(samples, from) {
  const length = Math.round(0.02 * RATE);
  const hop = Math.round(0.001 * RATE);
  const signal = new Float64Array(samples.length);
  for (let index = 1; index < samples.length; index++) {
    signal[index] = samples[index] - samples[index - 1];
  }
  const periodic = (start) => {
    let energy = 0;
    for (let index = 0; index < length; index++) {
      energy += signal[start + index] ** 2;
    }
    let best = 0;
    for (let lag = Math.round(RATE / 300); lag <= RATE / 70; lag++) {
      let product = 0;
      let other = 0;
      for (let index = 0; index < length; index++) {
        product += signal[start + index] * signal[start + index + lag];
        other += signal[start + index + lag] ** 2;
      }
      best = Math.max(best, product / Math.sqrt(energy * other + 1e-30));
    }
    return best >= 0.6;
  };
  let run = 0;
  for (let start = from; start + length + RATE / 70 < samples.length; ) {
    run = periodic(start) ? run + 1 : 0;
    if (run > 10) {
      return (start - 10 * hop) / RATE;
    }
    start += hop;
  }
  return NaN;
}

function peakTime(trace, key, from, to) {
  let best = from;
  for (let index = from; index < to; index++) {
    if (trace[index][key] > trace[best][key]) {
      best = index;
    }
  }
  return trace[best].time;
}

function stops() {
  console.log('');
  console.log(
    '2. Stops before [a]: times (ms) after the release (constriction area'
  );
  console.log(
    '   above 0.001 cm²) of the peaks of the flow derivative (transient),'
  );
  console.log(
    '   the frication and the aspiration source strengths, of the voicing'
  );
  console.log(
    '   channel crossing 0.5 and of the acoustic voice onset, and the peak of'
  );
  console.log(
    '   the first 3 ms against the peak of the first 20 ms rendered without'
  );
  console.log(
    '   the transient (TRANSIENT_GAIN 0), the frication alone (burst, dB).'
  );
  console.log(
    'word   transient  frication  aspiration  voicing  voice onset  burst dB'
  );
  // French has no rule that aspirates English onset stops: [p] stays plain.
  for (const word of ['pa', 'ta', 'ka', 'pʰa', 'tʰa', 'kʰa', 'ba']) {
    const plan = planUtterance(`ˈ${word}`, { language: 'fr' });
    const { samples, trace } = renderTrace(plan);
    const closure = plan.segments.find((item) => item.kind === 'consonant');
    const closed = trace.findIndex(
      (item) => item.time > closure.start && item.area <= 0.001
    );
    const release = trace.findIndex(
      (item, index) => index > closed && item.area > 0.001
    );
    const releaseTime = trace[release].time;
    const window = release + Math.round((0.15 * RATE) / BLOCK);
    const ms = (time) => ((time - releaseTime) * 1000).toFixed(1);
    const voiced = trace.find(
      (item, index) => index >= release && item.voicing >= 0.5
    );
    const onset = voiceOnset(samples, Math.floor(releaseTime * RATE));
    const releaseSample = Math.floor(releaseTime * RATE);
    const peak = (signal, milliseconds) => {
      let value = 0;
      const end = releaseSample + Math.round((milliseconds / 1000) * RATE);
      for (let index = releaseSample; index < end; index++) {
        value = Math.max(value, Math.abs(signal[index]));
      }
      return value;
    };
    const quiet = renderTrace(plan, undefined, QuietRenderer).samples;
    const burst = peak(samples, 3) / peak(quiet, 20);
    console.log(
      `${word.padEnd(6)} ${ms(peakTime(trace, 'transient', release - 4, window)).padStart(9)}  ` +
        `${ms(peakTime(trace, 'frication', release, window)).padStart(9)}  ` +
        `${ms(peakTime(trace, 'aspiration', release, window)).padStart(10)}  ` +
        `${(voiced ? ms(voiced.time) : '-').padStart(7)}  ` +
        `${ms(onset).padStart(11)}  ${decibels(burst).toFixed(2).padStart(8)}`
    );
  }
}

function lungPressure() {
  console.log('');
  console.log('3. [s] of ˈasa against the lung pressure (middle 60 %)');
  console.log('lungPressure Pa  level dB  against 800 Pa dB');
  const levels = new Map();
  for (const pressure of [400, 800, 1600]) {
    const head = normalizeHeadConfig({ lungPressure: pressure });
    const plan = planUtterance('ˈasa', { language: 'en', head });
    const { samples } = renderTrace(plan, head);
    const consonant = plan.segments.find((item) => item.kind === 'consonant');
    levels.set(pressure, decibels(rms(samples, ...middle(consonant))));
  }
  for (const [pressure, level] of levels) {
    console.log(
      `${String(pressure).padStart(15)}  ${level.toFixed(2).padStart(8)}  ` +
        `${(level - levels.get(800)).toFixed(2).padStart(17)}`
    );
  }
}

fricatives();
stops();
lungPressure();
