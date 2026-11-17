/** Shared labelled material for calibration and independent accuracy tests.
 * Segment edges are excluded by 10 ms, as specified in issue 62. */
import { synthesize, presetHeadConfig, analyzeFrames } from '../src/index.js';
import { CONSONANTS } from '../src/ipa/inventory.js';
import { createRandom } from '../src/random.js';
import {
  sonorityFilters,
  fillSonority,
  smoothSonority,
} from '../src/recognition/landmark-signals.js';

export function segmentClass(segment, previous) {
  if (segment.kind === 'pause') {
    return 0;
  }
  if (segment.kind === 'vowel') {
    return 1;
  }
  if (segment.kind === 'release') {
    return 7;
  }
  return consonantClass(segment, previous);
}

function consonantClass(segment, previous) {
  // The planner represents an affricate as two consonant segments sharing
  // one token: a stop closure, then its voiced or unvoiced frication.
  if (segment.token?.affricate) {
    return previous?.token === segment.token
      ? segment.token.voiced
        ? 4
        : 5
      : 6;
  }
  const manner = segment.token?.phoneme?.manner;
  if (manner === 'plosive' || manner === 'click') {
    return 6;
  }
  if (manner === 'nasal') {
    return 3;
  }
  if (manner === 'fricative' || manner === 'lateral-fricative') {
    return segment.token.voiced ? 4 : 5;
  }
  return 2;
}

export function frameTruth(plan, frames) {
  const truth = new Int8Array(frames.count).fill(-1);
  for (let t = 0, i = 0; t < frames.count; t++) {
    const time = frames.startTime + t * frames.hop;
    while (i + 1 < plan.segments.length && plan.segments[i].end <= time) {
      i++;
    }
    const seg = plan.segments[i];
    if (time >= seg.start + 0.01 && time <= seg.end - 0.01) {
      truth[t] = segmentClass(seg, plan.segments[i - 1]);
    }
  }
  return truth;
}

export function sonorityOf(frames) {
  const raw = new Float32Array(frames.count);
  const s = new Float32Array(frames.count);
  fillSonority(frames, raw, 0, sonorityFilters(frames));
  smoothSonority(raw, s, 0, frames.count, frames.hop);
  return s;
}

export function peakCurve(s, hop) {
  const peak = new Float32Array(s.length);
  for (let t = 0; t < s.length; t++) {
    let max = -Infinity;
    for (
      let j = Math.max(0, t - Math.round(0.2 / hop));
      j <= Math.min(s.length - 1, t + Math.round(0.04 / hop));
      j++
    ) {
      max = Math.max(max, s[j]);
    }
    peak[t] = max;
  }
  return peak;
}

/** Deterministic striding samples vowels, rates and voices evenly,
 * retaining both the clean and noisy rendition of each selected item. */
export function calibrationMaterial(fraction = 1) {
  if (!(fraction > 0 && fraction <= 1)) {
    throw new RangeError('fraction must be in (0,1]');
  }
  const stride = Math.round(1 / fraction);
  const material = [];
  let index = 0;
  for (const phone of Object.keys(CONSONANTS)) {
    for (const vowel of ['a', 'i', 'u']) {
      for (const preset of ['male', 'female', 'child']) {
        for (const rate of [8000, 11025, 16000]) {
          if (index++ % stride !== 0) {
            continue;
          }
          material.push(...renderPair(phone, vowel, preset, rate));
        }
      }
    }
  }
  return material;
}

function renderPair(phone, vowel, preset, rate) {
  const material = [];
  const out = synthesize(`${vowel}${phone}${vowel}`, {
    ipa: true,
    head: presetHeadConfig(preset),
    solver: 'waveguide',
    engine: 'js',
    sampleRate: rate,
    seed: 1,
  });
  let power = 0;
  for (const sample of out.samples) {
    power += sample * sample;
  }
  const noiseAmplitude = Math.sqrt((3 * power) / out.samples.length / 100);
  for (let noisy = 0; noisy < 2; noisy++) {
    const random = createRandom(
      `landmarks:${phone}:${vowel}:${preset}:${rate}`
    );
    const samples = noisy
      ? Float32Array.from(
          out.samples,
          (x) => x + noiseAmplitude * (2 * random() - 1)
        )
      : out.samples;
    const original = analyzeFrames(samples, rate);
    const frames = {
      rate,
      hop: original.hop,
      count: original.count,
      capacity: original.count,
      startTime: 0,
      melBands: original.melBands,
    };
    for (const key of [
      'energy',
      'noise',
      'speech',
      'periodicity',
      'zcr',
      'gravity',
      'tilt',
      'band',
    ]) {
      frames[key] = original[key].slice(
        0,
        original.count * (key === 'band' ? 6 : 1)
      );
    }
    const sonority = sonorityOf(original);
    material.push({
      id: `${vowel}${phone}${vowel}:${preset}:${rate}:${noisy}`,
      frames,
      sonority,
      peak: peakCurve(sonority, frames.hop),
      truth: frameTruth(out.plan, frames),
    });
  }
  return material;
}
