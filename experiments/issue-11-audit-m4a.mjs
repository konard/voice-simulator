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
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';
import { trackFormants } from '../src/recognition/formants.js';
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';

const show = (label, value) =>
  console.log(`${label}: ${JSON.stringify(value)}`);
const round = (value) => Math.round(value);

// 1. Formants of steady vowels: LPC envelope peaks (estimateFormants) against
//    the resonances of the same area function (tubeFormants).
const VOWELS = ['i', 'e', 'ɛ', 'a', 'ɑ', 'ɔ', 'o', 'u', 'ə', 'y'];
/** Prints the line `label preset@rate` of block 1 from `items`: per vowel
 * the f0, the truth (tubeFormants) and the measured F1 .. F3 (0 or NaN for
 * a missing one). */
function showVowels(label, items) {
  const errors = [[], [], []];
  let missing = 0;
  const worst = { vowel: '', error: 0 };
  for (const { vowel, truth, measured } of items) {
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
  show(label, {
    f0: items.at(-1).f0,
    meanErrorPercent: errors.map(mean),
    over10Percent: errors.map(
      (list) => list.filter((value) => value > 0.1).length
    ),
    missing,
    worst,
  });
}
/** Truth and f0 at time `centre` of `plan`. */
function plannedVowel(plan, head, centre) {
  const state = sampleState(plan, centre);
  const shape = tractShape(state, head);
  return {
    truth: tubeFormants(shape.areas, shape.length, { count: 3 }),
    f0: round(state.f0),
  };
}
for (const preset of ['male', 'female', 'child']) {
  for (const sampleRate of [16000, 8000]) {
    const items = VOWELS.map((vowel) => {
      const out = synthesize(`${vowel}ː`, {
        ipa: true,
        head: presetHeadConfig(preset),
        solver: 'waveguide',
        sampleRate,
        seed: 1,
      });
      const segment = out.plan.segments.find((item) => item.kind === 'vowel');
      const centre = (segment.start + segment.end) / 2;
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
      return { vowel, measured, ...plannedVowel(out.plan, out.head, centre) };
    });
    showVowels(`formants ${preset}@${sampleRate}`, items);
  }
}

// 1b. The same vowels through the formant tracker of the recognizer
//     (trackFormants, issue 60, tract length estimated), as one utterance
//     of 0.5 s per vowel so that the tract length is estimated from all of
//     them (as in tests/recognition-formants.test.js; a lone vowel can
//     settle on a wrong length, see experiments/issue-60-vowels.txt): the
//     row of the frame nearest to the centre of each vowel.
for (const preset of ['male', 'female', 'child']) {
  for (const sampleRate of [16000, 8000]) {
    const head = presetHeadConfig(preset);
    const plan = planUtterance(VOWELS.map((vowel) => `${vowel}ː`).join(''), {
      head,
      durations: VOWELS.map(() => 0.5),
    });
    const samples = renderPlan(plan, {
      head,
      solver: 'waveguide',
      sampleRate,
      seed: 1,
    });
    const track = trackFormants(analyzeFrames(samples, sampleRate));
    const segments = plan.segments.filter((item) => item.kind === 'vowel');
    const items = segments.map((segment, index) => {
      const centre = (segment.start + segment.end) / 2;
      const t = Math.round((centre - track.startTime) / track.hop);
      const measured = [0, 1, 2].map((k) =>
        track.valid[t * 4 + k] ? track.frequency[t * 4 + k] : 0
      );
      return {
        vowel: VOWELS[index],
        measured,
        ...plannedVowel(plan, head, centre),
      };
    });
    showVowels(`trackFormants ${preset}@${sampleRate}`, items);
  }
}

// 1c. How far the rendered vowels sit from tubeFormants: each vowel 2 s at
//     head.pitch 70 Hz (harmonics 70 Hz apart barely bias the poles),
//     trackFormants with the tract length of the head, the median per
//     formant over the frames of the vowel against tubeFormants of the
//     planned area function, in % (signed per vowel, mean of |%|).
for (const preset of ['male', 'female', 'child']) {
  for (const sampleRate of [16000, 8000]) {
    const head = { ...presetHeadConfig(preset), pitch: 70 };
    const difference = {};
    const sums = [0, 0, 0];
    for (const vowel of VOWELS) {
      const plan = planUtterance(`${vowel}ː`, { head, durations: [2] });
      const samples = renderPlan(plan, {
        head,
        solver: 'waveguide',
        sampleRate,
        seed: 1,
      });
      const track = trackFormants(analyzeFrames(samples, sampleRate), {
        vocalTractLength: head.vocalTractLength,
      });
      const segment = plan.segments.find((item) => item.kind === 'vowel');
      const centre = (segment.start + segment.end) / 2;
      const shape = tractShape(sampleState(plan, centre), head);
      const truth = tubeFormants(shape.areas, shape.length, { count: 3 });
      difference[vowel] = truth.map((expected, k) => {
        const values = [];
        for (let t = 0; t < track.count; t++) {
          const time = track.startTime + t * track.hop;
          if (
            time >= segment.start &&
            time < segment.end &&
            track.valid[t * 4 + k]
          ) {
            values.push(track.frequency[t * 4 + k]);
          }
        }
        values.sort((a, b) => a - b);
        const median = values[values.length >> 1];
        const percent = Number((100 * (median / expected - 1)).toFixed(1));
        sums[k] += Math.abs(percent);
        return percent;
      });
    }
    show(`renderer formants ${preset}@${sampleRate}`, {
      pitch: 70,
      meanDifferencePercent: sums.map((sum) =>
        Number((sum / VOWELS.length).toFixed(1))
      ),
      differencePercent: difference,
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

// 2b. Pitch and voicing per 10 ms frame from the tracker of the recognizer
//     (trackPitch, issue 59) over the same frame times and the same truth.
for (const preset of ['male', 'female', 'child']) {
  for (const sampleRate of [16000, 8000]) {
    const out = synthesize(TEXT, {
      head: presetHeadConfig(preset),
      solver: 'waveguide',
      sampleRate,
      seed: 1,
    });
    const frameSet = analyzeFrames(out.samples, out.sampleRate, { hop: 0.01 });
    const track = trackPitch(frameSet);
    // The frame times of block 2: 0.02 s on, while 0.08 s of sound remain.
    const duration = out.samples.length / out.sampleRate;
    let voiced = 0;
    let gross = 0;
    let voicingErrors = 0;
    let frames = 0;
    let fine = 0;
    for (let t = 0; t < track.count; t++) {
      const time = track.startTime + t * track.hop;
      if (time < 0.02 - 1e-9 || time + 0.06 > duration) {
        continue;
      }
      const state = sampleState(out.plan, time);
      const truthVoiced = state.voicing > 0.5 && state.loudness > 0.3;
      const f0 = track.f0[t];
      const estimateVoiced = f0 > 0;
      frames += 1;
      if (truthVoiced !== estimateVoiced) {
        voicingErrors += 1;
      }
      if (truthVoiced && estimateVoiced) {
        voiced += 1;
        const error = Math.abs(f0 - state.f0) / state.f0;
        if (error > 0.2) {
          gross += 1;
        } else {
          fine += Math.abs(1200 * Math.log2(f0 / state.f0));
        }
      }
    }
    show(`trackPitch ${preset}@${sampleRate}`, {
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
