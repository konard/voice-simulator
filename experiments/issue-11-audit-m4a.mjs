// Audit of the analysis code for the M4 plan (issues P46 to P55 of issue 11).
// How well do the existing per-frame estimators agree with the truth that
// the simulator knows about its own output?
// Run: node experiments/issue-11-audit-m4a.mjs > experiments/issue-11-audit-m4a.txt
import { performance } from 'node:perf_hooks';
import { synthesize } from '../src/synthesize.js';
import { estimateFormants } from '../src/acoustics/analysis.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { tractShape, sampleState } from '../src/articulation/tract-shape.js';
import {
  analyzeVoice,
  resample,
  yinPitch,
} from '../src/analysis/voice-features.js';
import { presetHeadConfig } from '../src/head-config.js';

const show = (label, value) =>
  console.log(`${label}: ${JSON.stringify(value)}`);
const round = (value) => Math.round(value);

// 1. Formants of steady vowels: LPC envelope peaks (estimateFormants) against
//    the resonances of the same area function (tubeFormants).
const VOWELS = ['i', 'e', 'ɛ', 'a', 'ɑ', 'ɔ', 'o', 'u', 'ə', 'y'];
for (const preset of ['male', 'female', 'child']) {
  for (const sampleRate of [16000, 8000]) {
    const errors = [[], [], []];
    let missing = 0;
    const worst = { vowel: '', error: 0 };
    let f0 = 0;
    for (const vowel of VOWELS) {
      const out = synthesize(`${vowel}ː`, {
        ipa: true,
        head: presetHeadConfig(preset),
        solver: 'waveguide',
        sampleRate,
        seed: 1,
      });
      const segment = out.plan.segments.find((item) => item.kind === 'vowel');
      const centre = (segment.start + segment.end) / 2;
      const state = sampleState(out.plan, centre);
      const shape = tractShape(state, out.head);
      const truth = tubeFormants(shape.areas, shape.length, { count: 3 });
      f0 = round(state.f0);
      // Same call as analyzeVoice(): resample to at most 11025 Hz, 30 ms
      // frame, order = rate / 1000 + 1.
      const analysed = resample(out.samples, out.sampleRate);
      const measured = estimateFormants(analysed.samples, analysed.sampleRate, {
        start: centre - 0.015,
        duration: 0.03,
        count: 3,
        analysisRate: analysed.sampleRate,
        order: Math.round(analysed.sampleRate / 1000) + 1,
      });
      truth.forEach((expected, index) => {
        if (!(measured[index] > 0)) {
          missing += 1;
          return;
        }
        const error = Math.abs(measured[index] - expected) / expected;
        errors[index].push(error);
        if (error > worst.error) {
          Object.assign(worst, {
            vowel,
            formant: index + 1,
            truth: round(expected),
            measured: round(measured[index]),
            error: Number(error.toFixed(2)),
          });
        }
      });
    }
    const mean = (list) =>
      Number(
        (
          (100 * list.reduce((sum, value) => sum + value, 0)) /
          Math.max(1, list.length)
        ).toFixed(1)
      );
    show(`formants ${preset}@${sampleRate}`, {
      f0,
      meanErrorPercent: errors.map(mean),
      over10Percent: errors.map(
        (list) => list.filter((value) => value > 0.1).length
      ),
      missing,
      worst,
    });
  }
}

// 2. Pitch and voicing per 10 ms frame: YIN on each frame alone (no tracking)
//    against the planned f0 and voicing channels.
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
for (const preset of ['male', 'female', 'child']) {
  for (const sampleRate of [16000, 8000]) {
    const out = synthesize(TEXT, {
      head: presetHeadConfig(preset),
      solver: 'waveguide',
      sampleRate,
      seed: 1,
    });
    const { samples, sampleRate: rate } = resample(out.samples, out.sampleRate);
    const window = Math.round(0.04 * rate);
    const hop = Math.round(0.01 * rate);
    let voiced = 0;
    let gross = 0;
    let voicingErrors = 0;
    let frames = 0;
    let fine = 0;
    for (let start = 0; start + window * 2 < samples.length; start += hop) {
      const time = (start + window / 2) / rate;
      const state = sampleState(out.plan, time);
      const truthVoiced = state.voicing > 0.5 && state.loudness > 0.3;
      const pitch = yinPitch(samples, start, window, rate);
      const estimateVoiced = pitch.f0 > 0 && pitch.aperiodicity < 0.35;
      frames += 1;
      if (truthVoiced !== estimateVoiced) {
        voicingErrors += 1;
      }
      if (truthVoiced && estimateVoiced) {
        voiced += 1;
        const error = Math.abs(pitch.f0 - state.f0) / state.f0;
        if (error > 0.2) {
          gross += 1;
        } else {
          fine += Math.abs(1200 * Math.log2(pitch.f0 / state.f0));
        }
      }
    }
    show(`pitch ${preset}@${sampleRate}`, {
      frames,
      grossPitchErrorPercent: Number(((100 * gross) / voiced).toFixed(1)),
      voicingDecisionErrorPercent: Number(
        ((100 * voicingErrors) / frames).toFixed(1)
      ),
      fineErrorCents: Number((fine / Math.max(1, voiced - gross)).toFixed(1)),
    });
  }
}

// 3. Cost of the existing batch analysis (share of real time, one core).
{
  const out = synthesize(TEXT, { solver: 'waveguide', sampleRate: 16000 });
  const started = performance.now();
  for (let run = 0; run < 3; run++) {
    analyzeVoice(out.samples, out.sampleRate);
  }
  const elapsed = (performance.now() - started) / 3000;
  show('analyzeVoice cost', {
    seconds: Number(out.duration.toFixed(2)),
    realTimeFactor: Number((elapsed / out.duration).toFixed(3)),
  });
}
