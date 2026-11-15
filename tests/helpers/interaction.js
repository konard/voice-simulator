/**
 * Static vowels for the source-tract interaction (issue 34): the vocal
 * folds (folds.js) on a 44-section waveguide shaped as the middle of a
 * vowel, with or without interaction (the tract's and the trachea's waves
 * fed back to the folds, as VoiceRenderer does with `interaction`), and
 * measurements of the glottal flow and the radiated sound. Used by
 * tests/interaction.test.js and experiments/issue-11-interaction.mjs.
 */

import {
  decimate,
  harmonicLevel,
  impulseSpectrum,
  lpcCoefficients,
  lpcEnvelope,
  resonances,
} from '../../src/acoustics/analysis.js';
import {
  IncidentPressure,
  VocalFolds,
  flowPitch,
  tensionForPitch,
} from '../../src/acoustics/folds.js';
import { Subglottal } from '../../src/acoustics/subglottal.js';
import { SPEED_OF_SOUND } from '../../src/acoustics/transfer.js';
import { blockShape, noseSections } from '../../src/acoustics/voice.js';
import { Waveguide } from '../../src/acoustics/waveguide.js';
import { noseShape } from '../../src/articulation/tract-shape.js';
import { planUtterance } from '../../src/articulation/plan.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../../src/head-config.js';

const SECTIONS = 44;
/** Lung pressure (Pa) of the static vowels. */
export const VOWEL_PRESSURE = 800;

/**
 * Tract shape (normalized head, 44 sections) in the middle of the longest
 * segment of an IPA string.
 * @param {string} ipa
 * @param {object} head
 */
export function vowelShape(ipa, head) {
  const plan = planUtterance(ipa, { head });
  const longest = plan.segments.reduce((best, segment) =>
    segment.end - segment.start > best.end - best.start ? segment : best
  );
  return blockShape(plan, (longest.start + longest.end) / 2, {}, head, {
    sections: SECTIONS,
    teeth: true,
  });
}

/**
 * A 44-section waveguide shaped as the middle of a vowel.
 * @param {string} ipa
 * @param {object} head Normalized head.
 * @returns {{guide: Waveguide, dt: number, shape: object}}
 */
export function vowelTract(ipa, head) {
  const shape = vowelShape(ipa, head);
  const guide = new Waveguide({
    sections: SECTIONS,
    noseSections: noseSections(head, SECTIONS),
    head,
  });
  guide.setNose(noseShape(head).areas);
  guide.setShape(
    shape.areas,
    shape.velumArea,
    shape.velumIndex,
    shape.teeth,
    shape
  );
  guide.setLength(shape.length);
  return { guide, dt: shape.length / (SECTIONS * SPEED_OF_SOUND), shape };
}

/**
 * First resonance (Hz, -3 dB bandwidth) of a vowel's tract whose glottal
 * end reflects `reflection` of the arriving waves: 1 for a closed glottis,
 * 0 for one that absorbs them all.
 * @param {string} ipa
 * @param {number} reflection
 * @param {object} [head]
 */
export function tractResonance(ipa, reflection, head = DEFAULT_HEAD) {
  const { guide, dt } = vowelTract(ipa, normalizeHeadConfig(head));
  guide.setGlottalReflection(reflection);
  const response = new Float64Array(Math.round(0.1 / dt));
  for (let index = 0; index < response.length; index++) {
    response[index] = guide.step(index === 0 ? 1 : 0, 1, 0, 0);
  }
  const spectrum = impulseSpectrum(response, 1 / dt, {
    from: 150,
    to: 2500,
    step: 5,
  });
  return resonances(spectrum, { count: 1, from: 150 })[0];
}

/**
 * Run the folds on a static vowel.
 * @param {string} ipa
 * @param {{interaction?: boolean, subglottal?: boolean, f0?: number, adduction?: number, duration?: number, head?: object}} [options]
 * @returns {{flow: Float64Array, output: Float64Array, rate: number, f0: number, head: object}}
 *   The glottal flow (cm³/s) and the radiated output at every step of the
 *   waveguide (`rate` Hz).
 */
export function runVowel(ipa, options = {}) {
  const head = normalizeHeadConfig(options.head ?? DEFAULT_HEAD);
  const f0 = options.f0 ?? 120;
  const { guide, dt } = vowelTract(ipa, head);
  const folds = new VocalFolds({
    breathiness: head.breathiness,
    aspirationLevel: head.aspirationLevel,
    foldLength: head.foldLength,
    foldMass: head.foldMass,
    foldStiffness: head.foldStiffness,
    foldDamping: head.foldDamping,
  });
  const control = {
    voicing: 1,
    aspiration: 0,
    closure: 0,
    loudness: 1,
    lungPressure: VOWEL_PRESSURE,
    adduction: options.adduction ?? 0.5,
    foldTension: tensionForPitch(f0, VOWEL_PRESSURE, head),
    oralPressure: 0,
  };
  const interaction = options.interaction ?? false;
  const subglottal =
    interaction && (options.subglottal ?? true)
      ? new Subglottal(head, dt)
      : null;
  const above = new IncidentPressure();
  const below = new IncidentPressure();
  const load = {
    below: { pressure: 0, area: Infinity },
    above: { pressure: 0, area: Infinity },
  };
  if (interaction) {
    guide.setGlottalReflection(1);
  }
  const count = Math.round((options.duration ?? 0.4) / dt);
  const flow = new Float64Array(count);
  const output = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    let source;
    if (interaction) {
      const tract = guide.glottalLoad();
      load.above.pressure = above.step(tract.incident, dt);
      load.above.area = tract.area;
      if (subglottal) {
        load.below.pressure = below.step(subglottal.incident, dt);
        load.below.area = subglottal.area;
      }
      source = folds.step(dt, control, 0, load);
      subglottal?.step(-source);
    } else {
      source = folds.step(dt, control, 0);
    }
    flow[index] = folds.flow;
    output[index] = guide.step(source, 1, 0, 0);
  }
  return { flow, output, rate: 1 / dt, f0, head };
}

/** The last `seconds` of a run (s), past the onset. */
export function tail(samples, rate, seconds = 0.2) {
  return samples.subarray(samples.length - Math.round(seconds * rate));
}

/**
 * Open phases of a glottal flow: the runs above 5 % of its range over
 * its minimum, complete within the samples.
 * @param {ArrayLike<number>} flow
 * @returns {{open: number, peak: number, close: number}[]} Sample indices
 *   of the opening, the peak and the closure.
 */
export function openPhases(flow) {
  let low = Infinity;
  let high = -Infinity;
  for (const value of flow) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const threshold = low + 0.05 * (high - low);
  const phases = [];
  let open = -1;
  for (let index = 1; index < flow.length; index++) {
    const above = flow[index] > threshold;
    if (above && flow[index - 1] <= threshold) {
      open = index;
    } else if (!above && flow[index - 1] > threshold && open > 0) {
      let peak = open;
      for (let at = open; at < index; at++) {
        if (flow[at] > flow[peak]) {
          peak = at;
        }
      }
      phases.push({ open, peak, close: index });
      open = -1;
    }
  }
  return phases;
}

/**
 * Skew of the glottal pulses: the mean time from the opening to the peak
 * divided by the open time.
 * @param {ArrayLike<number>} flow
 */
export function pulseSkew(flow) {
  const phases = openPhases(flow);
  let sum = 0;
  for (const { open, peak, close } of phases) {
    sum += (peak - open) / (close - open);
  }
  return sum / Math.max(1, phases.length);
}

/**
 * Flow minus its local quadratic trend: for each sample of [from, to), a
 * least-squares parabola through the samples within `half` of it (and
 * within the range) is subtracted. A centred moving average of 3 ms
 * would leave the curvature of a 5 ms pulse, about 10 % of its peak with
 * or without interaction; the parabola keeps only what swings faster.
 * @param {ArrayLike<number>} flow
 * @param {number} from
 * @param {number} to
 * @param {number} half
 */
function localResidual(flow, from, to, half) {
  const residual = new Float64Array(to - from);
  const moments = new Float64Array(5);
  const values = new Float64Array(3);
  for (let index = from; index < to; index++) {
    moments.fill(0);
    values.fill(0);
    const last = Math.min(to - 1, index + half);
    for (let at = Math.max(from, index - half); at <= last; at++) {
      const t = (at - index) / half;
      let power = 1;
      for (let k = 0; k < 5; k++) {
        moments[k] += power;
        if (k < 3) {
          values[k] += power * flow[at];
        }
        power *= t;
      }
    }
    // Normal equations of the parabola; its value at t = 0 is c0.
    const m = [0, 1, 2].map((row) => [
      moments[row],
      moments[row + 1],
      moments[row + 2],
      values[row],
    ]);
    for (let column = 0; column < 3; column++) {
      for (let row = column + 1; row < 3; row++) {
        const factor = m[row][column] / m[column][column];
        for (let k = column; k < 4; k++) {
          m[row][k] -= factor * m[column][k];
        }
      }
    }
    const c2 = m[2][3] / m[2][2];
    const c1 = (m[1][3] - m[1][2] * c2) / m[1][1];
    const c0 = (m[0][3] - m[0][1] * c1 - m[0][2] * c2) / m[0][0];
    residual[index - from] = flow[index] - c0;
  }
  return residual;
}

/**
 * Ripple of the glottal flow: the flow minus its 3 ms local quadratic
 * trend (localResidual), inside the open phases (`part: 'open'`) or on
 * their rising flanks (`part: 'rising'`, opening to peak). Returns the
 * dominant frequency of the residual (Hz; summed Hann-windowed spectra of
 * the phases on a 25 Hz grid, 200-2000 Hz) and its RMS relative to the
 * peak flow.
 * @param {ArrayLike<number>} flow
 * @param {number} rate
 * @param {{part?: 'open' | 'rising'}} [options]
 * @returns {{frequency: number, size: number}}
 */
export function flowRipple(flow, rate, options = {}) {
  const half = Math.round(0.0015 * rate);
  const frequencies = [];
  for (let frequency = 200; frequency <= 2000; frequency += 25) {
    frequencies.push(frequency);
  }
  const power = new Float64Array(frequencies.length);
  let squares = 0;
  let count = 0;
  let peak = 0;
  for (const phase of openPhases(flow)) {
    const end = options.part === 'rising' ? phase.peak + 1 : phase.close;
    peak = Math.max(peak, flow[phase.peak]);
    const residual = localResidual(flow, phase.open, end, half);
    const length = residual.length;
    if (length < 4) {
      continue;
    }
    for (let at = 0; at < length; at++) {
      squares += residual[at] ** 2;
      count++;
      residual[at] *= 0.5 - 0.5 * Math.cos((2 * Math.PI * at) / (length - 1));
    }
    frequencies.forEach((frequency, bin) => {
      const omega = (2 * Math.PI * frequency) / rate;
      let re = 0;
      let im = 0;
      for (let at = 0; at < length; at++) {
        re += residual[at] * Math.cos(omega * at);
        im -= residual[at] * Math.sin(omega * at);
      }
      power[bin] += re * re + im * im;
    });
  }
  let best = 0;
  for (let bin = 1; bin < power.length; bin++) {
    if (power[bin] > power[best]) {
      best = bin;
    }
  }
  return {
    frequency: frequencies[best],
    size: Math.sqrt(squares / Math.max(1, count)) / (peak || 1),
  };
}

/**
 * First formant (Hz) and its -3 dB bandwidth (Hz) of a stretch of sound:
 * the first peak of an LPC envelope (order 12 at 11025 Hz, pre-emphasis
 * 0.94, Hamming window).
 * @param {ArrayLike<number>} samples
 * @param {number} rate
 * @returns {{frequency: number, bandwidth: number}}
 */
export function firstFormant(samples, rate) {
  const { samples: frame, sampleRate } = decimate(samples, rate, 11025);
  for (let index = frame.length - 1; index > 0; index--) {
    frame[index] -= 0.94 * frame[index - 1];
  }
  for (let index = 0; index < frame.length; index++) {
    frame[index] *=
      0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (frame.length - 1));
  }
  const envelope = lpcEnvelope(lpcCoefficients(frame, 12), sampleRate, 5);
  return resonances(envelope, { count: 1, from: 150 })[0];
}

/**
 * H1-H2 (dB) of a stretch of sound: the levels of its first two
 * harmonics, the pitch measured on the glottal flow.
 * @param {ArrayLike<number>} samples
 * @param {ArrayLike<number>} flow
 * @param {number} rate
 */
export function harmonicDifference(samples, flow, rate) {
  const f0 = flowPitch(flow, rate);
  const duration = samples.length / rate;
  return (
    harmonicLevel(samples, rate, f0, { duration }) -
    harmonicLevel(samples, rate, 2 * f0, { duration })
  );
}

/**
 * Resonances of the subglottal line of a head at a step dt (s): the
 * spectrum of the wave arriving back at the glottis after a flow impulse.
 * @param {object} head
 * @param {number} dt
 * @param {number} [count]
 */
export function subglottalResonances(head, dt, count = 3) {
  const line = new Subglottal(head, dt);
  const response = new Float64Array(Math.round(0.2 / dt));
  for (let index = 0; index < response.length; index++) {
    line.step(index === 0 ? 1 : 0);
    response[index] = line.incident;
  }
  const spectrum = impulseSpectrum(response, 1 / dt, {
    from: 100,
    to: 4000,
    step: 5,
  });
  return resonances(spectrum, { count });
}
