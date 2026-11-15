/**
 * Physical voice source: the symmetric two-mass model of the vocal folds
 * (Steinecke and Herzel 1995, a simplified form of Ishizaka and Flanagan
 * 1972), driven by the lung pressure.
 *
 * Each fold is a lower mass (index 1) and an upper mass (index 2) on
 * springs, coupled by a spring `kc`. The air from the lungs pushes the
 * lower mass apart while the glottis converges; the jet separates at the
 * narrowest point, so no pressure acts on the upper mass. The masses close
 * the glottis again and collide (an extra spring `c_i` while the area is
 * negative). The flow through the glottis follows Bernoulli:
 *
 *   m_i x_i'' + r_i x_i' + k_i x_i + kc (x_i - x_j) + collision_i = F_i
 *   a_i = a0_i + 2 L x_i,   a_min = max(0, min(a_1, a_2))
 *   P_1 = Ps (1 - (a_min / a_1)²) when a_1 > 0,   F_1 = L d_1 P_1,  F_2 = 0
 *   U = a_min sqrt(2 Ps / rho)
 *
 * Units inside this file are cgs (cm, g, s, dyn); 1 Pa = 10 dyn/cm².
 * Pitch, loudness and voice quality follow from the lung pressure, the
 * tension factor Q and the adduction (rest area), as in a real larynx.
 *
 * Three deliberate departures from the literal model, all measured by
 * experiments/issue-33-folds-variants.mjs:
 * - the lower mass rests REST_CONVERGENCE (0.0005 cm²) wider than the upper
 *   one. With equal rest areas P_1 is exactly 0 at rest and the folds never
 *   start from rest; a convergent glottis at rest is also the physiological
 *   prephonatory shape (Titze 1988);
 * - tension Q multiplies k_i and kc and divides m_i and the damping r_i, and
 *   leaves d_i alone. Dividing d_i by Q (Ishizaka and Flanagan) with a fixed
 *   damping raises the threshold pressure from 175 Pa at Q = 1 to 575 Pa at
 *   Q = 2 and 2050 Pa at Q = 4; at 800 Pa the flow shrinks to 4 % at Q = 2
 *   (250 Hz) and stops above Q = 2.5 (310 Hz), so a female or child voice
 *   could hardly phonate. With this scaling the damping times 2 m_i / r_i
 *   stay as in the table, the threshold only rises to 400 Pa at Q = 4 and
 *   the flow at 800 Pa keeps 73 % at Q = 2;
 * - while the lower mass is closed (a_1 <= 0) the full lung pressure acts
 *   on it, as in Ishizaka and Flanagan (1972); the literal model has no
 *   pressure there. Without it the force jumps by L d_1 Ps when the lower
 *   mass starts to touch, and the pitch jumps by 5 % there (from 294.5 Hz
 *   at Q = 2.23 to 309.5 Hz at Q = 2.24, at 800 Pa), so pitches in between
 *   could not be reached.
 */

import { AIR_DENSITY } from './transfer.js';
import { BREATH_EXPONENT, BREATH_GAIN } from './glottis.js';
import { lagFactor, openTractStrength } from './aerodynamics.js';

/** Masses of the lower and the upper part of a fold (g). */
export const FOLD_MASS_1 = 0.125;
export const FOLD_MASS_2 = 0.025;
/** Stiffness of the lower and the upper part (dyn/cm). */
export const FOLD_STIFFNESS_1 = 80000;
export const FOLD_STIFFNESS_2 = 8000;
/** Coupling stiffness between the two parts (dyn/cm). */
export const FOLD_COUPLING = 25000;
/** Damping of the lower and the upper part (g/s). */
export const FOLD_DAMPING_1 = 20;
export const FOLD_DAMPING_2 = 20;
/** Extra stiffness while a part is in collision, as a factor on k_i. */
export const FOLD_COLLISION = 3;
/** Thickness of the lower and the upper part (cm). */
export const FOLD_THICKNESS_1 = 0.25;
export const FOLD_THICKNESS_2 = 0.05;
/** Length of the vibrating folds (cm). */
export const FOLD_LENGTH = 1.4;
/** Rest area of the glottis between both parts at modal adduction (cm²). */
export const FOLD_REST_AREA = 0.05;
/** The lower part rests this much wider (cm²) so that the folds can start. */
export const REST_CONVERGENCE = 0.0005;
/** Rate of the inner time steps (Hz). */
export const FOLD_RATE = 44100;
/** Tension range (factor Q of Ishizaka and Flanagan). */
export const MIN_FOLD_TENSION = 0.4;
export const MAX_FOLD_TENSION = 5;
/**
 * Scales the flow derivative (cm³/s²) so that a steady vowel at 800 Pa and
 * adduction 0.5 has the RMS of the LF source at its defaults, both at the
 * LF pitch of 120 Hz (Q = 0.816; Q = 1 gives 147 Hz with this model, and
 * the RMS of the folds rises with the pitch while that of LF does not;
 * experiments/issue-33-folds-scale.mjs).
 */
export const FOLDS_FLOW_SCALE = 1.403e-6;
/**
 * Time constant (s) with which the lung pressure and the rest area follow
 * their controls. The controls change in blocks (32 samples in
 * VoiceRenderer); a step in the pressure is a step in the flow and so a
 * click in its derivative.
 */
export const FOLD_CONTROL_TIME = 0.003;

/** Rest area (cm²) by adduction: open, breathy, modal and pressed. */
export const ADDUCTION_TABLE = Object.freeze([
  Object.freeze([0, 0.3]),
  Object.freeze([0.25, 0.1]),
  Object.freeze([0.5, 0.05]),
  Object.freeze([1, -0.02]),
]);

/**
 * Time constant (s) of each of the MEAN_AREA_STAGES one-pole stages of the
 * mean glottal area that the air flow of VoiceRenderer uses (issue 35).
 * The mean must not follow the cycles of the folds: their ripple becomes a
 * flow derivative, and the burst transient injects it at the constriction.
 * One stage of 10 ms left a ripple that took 1.8 dB off the vowels of the
 * fold source; three of 5 ms (together 15 ms, shorter than a phone) leave
 * 0.1 dB (experiments/issue-35-folds-airflow.mjs).
 */
export const MEAN_AREA_TIME = 0.005;
export const MEAN_AREA_STAGES = 3;

const PASCAL = 10; // dyn/cm² per Pa
const REFERENCE_PRESSURE = 800 * PASCAL;
/** Area at which the breath noise is no longer reduced (cm²). */
const NOISE_AREA = 0.1;

/**
 * Rest area of the glottis (cm²) for an adduction from 0 to 1.
 * @param {number} adduction
 */
export function restArea(adduction) {
  const value = Math.min(1, Math.max(0, adduction));
  let index = 1;
  while (
    index < ADDUCTION_TABLE.length - 1 &&
    value > ADDUCTION_TABLE[index][0]
  ) {
    index++;
  }
  const [x0, y0] = ADDUCTION_TABLE[index - 1];
  const [x1, y1] = ADDUCTION_TABLE[index];
  return y0 + ((y1 - y0) * (value - x0)) / (x1 - x0);
}

function clampTension(value) {
  return Math.min(MAX_FOLD_TENSION, Math.max(MIN_FOLD_TENSION, value));
}

export class VocalFolds {
  /**
   * @param {{breathiness?: number, aspirationLevel?: number, foldLength?: number, foldMass?: number, foldStiffness?: number, foldDamping?: number, rate?: number}} [options]
   *   Head values; `rate` overrides FOLD_RATE (for tests of the step size).
   */
  constructor(options = {}) {
    this.breathiness = options.breathiness ?? 0.2;
    this.breathGain = BREATH_GAIN * this.breathiness ** BREATH_EXPONENT;
    this.aspirationLevel = options.aspirationLevel ?? 1;
    this.length = options.foldLength ?? FOLD_LENGTH;
    this.massFactor = options.foldMass ?? 1;
    this.stiffnessFactor = options.foldStiffness ?? 1;
    this.dampingFactor = options.foldDamping ?? 1;
    this.rate = options.rate ?? FOLD_RATE;
    this.tension = Number.NaN;
    this.adduction = Number.NaN;
    this.dt = Number.NaN;
    this.reset();
  }

  /** Back to rest: folds still, no flow. */
  reset() {
    this.x1 = 0;
    this.x2 = 0;
    this.v1 = 0;
    this.v2 = 0;
    this.area = 0;
    this.meanArea = 0;
    this.meanStages = new Float64Array(MEAN_AREA_STAGES);
    this.u = 0;
    this.pressure = 0;
    this.started = false;
    this.intensity = 0;
    this.noiseModulation = 0;
  }

  /** Glottal flow after the last step (cm³/s). */
  get flow() {
    return this.u;
  }

  #setTension(q) {
    if (q === this.tension) {
      return;
    }
    this.tension = q;
    const stiffness = q * this.stiffnessFactor;
    const mass = this.massFactor / q;
    const damping = this.dampingFactor / q;
    this.m1 = FOLD_MASS_1 * mass;
    this.m2 = FOLD_MASS_2 * mass;
    this.k1 = FOLD_STIFFNESS_1 * stiffness;
    this.k2 = FOLD_STIFFNESS_2 * stiffness;
    this.kc = FOLD_COUPLING * stiffness;
    this.r1 = FOLD_DAMPING_1 * damping;
    this.r2 = FOLD_DAMPING_2 * damping;
    // Collision springs act on the area: c_i a_i / (2 L).
    this.c1 = (FOLD_COLLISION * this.k1) / (2 * this.length);
    this.c2 = (FOLD_COLLISION * this.k2) / (2 * this.length);
  }

  /**
   * Low-pass the open area through MEAN_AREA_STAGES one-pole stages; the
   * first step after a reset starts them at the rest area.
   */
  #updateMeanArea(open, rest) {
    if (!this.started) {
      this.meanArea = rest;
      this.meanStages.fill(rest);
      return;
    }
    let input = open;
    for (let index = 0; index < MEAN_AREA_STAGES; index++) {
      const stage = this.meanStages[index];
      input = stage + this.meanFollow * (input - stage);
      this.meanStages[index] = input;
    }
    this.meanArea = input;
  }

  /**
   * Advance by dt seconds and return the flow derivative sample.
   * @param {number} dt
   * @param {{voicing: number, aspiration: number, closure: number, loudness: number, lungPressure: number, adduction: number, foldTension: number, aspirationStrength?: number, oralPressure?: number}} control
   *   `aspirationStrength` is the relative turbulence strength at the
   *   glottis from the air flow (VoiceRenderer); without it the folds
   *   assume an open tract at the lung pressure and their mean area.
   *   `oralPressure` (dyn/cm²) is not used yet (#34).
   * @param {number} noise White noise sample in [-1, 1].
   */
  step(dt, control, noise) {
    const closure = control.closure;
    this.#setTension(clampTension(control.foldTension));
    if (control.adduction !== this.adduction) {
      this.adduction = control.adduction;
      this.targetArea = restArea(control.adduction);
    }
    if (dt !== this.dt) {
      this.dt = dt;
      this.steps = Math.max(1, Math.ceil(dt * this.rate));
      this.follow = 1 - Math.exp(-dt / FOLD_CONTROL_TIME);
      this.meanFollow = lagFactor(dt / MEAN_AREA_TIME);
    }
    const target = Math.max(0, control.lungPressure) * PASCAL * (1 - closure);
    if (this.started) {
      this.pressure += this.follow * (target - this.pressure);
      this.a02 += this.follow * (this.targetArea - this.a02);
    } else {
      this.pressure = target;
      this.a02 = this.targetArea;
    }
    const pressure = this.pressure;
    const a02 = this.a02;
    const a01 = a02 + REST_CONVERGENCE;
    const twoL = 2 * this.length;
    const drive = this.length * FOLD_THICKNESS_1 * pressure;
    const steps = this.steps;
    const h = dt / steps;
    let { x1, x2, v1, v2 } = this;
    for (let index = 0; index < steps; index++) {
      const a1 = a01 + twoL * x1;
      const a2 = a02 + twoL * x2;
      let f1 = -this.r1 * v1 - this.k1 * x1 - this.kc * (x1 - x2);
      let f2 = -this.r2 * v2 - this.k2 * x2 - this.kc * (x2 - x1);
      if (a1 > 0) {
        const ratio = Math.max(0, Math.min(a1, a2)) / a1;
        f1 += drive * (1 - ratio * ratio);
      } else {
        // Closed below: the full lung pressure acts on the lower mass.
        f1 += drive - this.c1 * a1;
      }
      if (a2 < 0) {
        f2 -= this.c2 * a2;
      }
      // Semi-implicit Euler: velocities first, then positions.
      v1 += (h * f1) / this.m1;
      v2 += (h * f2) / this.m2;
      x1 += h * v1;
      x2 += h * v2;
    }
    this.x1 = x1;
    this.x2 = x2;
    this.v1 = v1;
    this.v2 = v2;
    const area = Math.max(0, Math.min(a01 + twoL * x1, a02 + twoL * x2));
    const flow = area * Math.sqrt((2 * pressure) / AIR_DENSITY);
    // The first step after a reset sets the flow without a jump to it.
    const previous = this.started ? this.u : flow;
    this.#updateMeanArea(
      area * (1 - closure),
      Math.max(0, a02) * (1 - closure)
    );
    this.started = true;
    const derivative = ((flow - previous) / dt) * FOLDS_FLOW_SCALE;
    this.area = area;
    this.u = flow;

    const voicing = Math.max(0, control.voicing) * (1 - closure);
    const relative = pressure / REFERENCE_PRESSURE;
    this.intensity = voicing * relative * Math.sqrt(relative);
    // Breath noise as in Glottis, strongest while the glottis is open and
    // scaled by the turbulence source strength at the glottis.
    const modulation = Math.min(1, area / NOISE_AREA);
    this.noiseModulation = modulation;
    const strength =
      control.aspirationStrength ?? openTractStrength(pressure, this.meanArea);
    const breath =
      (control.aspiration + this.breathGain * voicing) * (1 - closure);
    return (
      derivative +
      noise * breath * modulation * strength * 0.45 * this.aspirationLevel
    );
  }
}

/** Measured pitch (Hz) of a flow: upward zero crossings of U - mean(U). */
export function flowPitch(flow, sampleRate) {
  let mean = 0;
  for (const value of flow) {
    mean += value;
  }
  mean /= flow.length;
  let first = -1;
  let last = -1;
  let count = 0;
  for (let index = 1; index < flow.length; index++) {
    const before = flow[index - 1] - mean;
    const after = flow[index] - mean;
    if (before < 0 && after >= 0) {
      const time = index - 1 + before / (before - after);
      if (first < 0) {
        first = time;
      }
      last = time;
      count++;
    }
  }
  if (count < 2 || last <= first) {
    return 0;
  }
  return ((count - 1) * sampleRate) / (last - first);
}

/** Pressures (Pa) and tensions of the pitch table of tensionForPitch. */
export const TENSION_TABLE_PRESSURES = Object.freeze([400, 800, 1600]);
export const TENSION_TABLE_TENSIONS = Object.freeze(
  Array.from({ length: 24 }, (_, index) =>
    Number((0.4 + 0.2 * index).toFixed(1))
  )
);
const TABLE_DURATION = 0.15;
const TABLE_WINDOW = 0.1;
const TABLE_ADDUCTION = 0.5;
const TABLE_CACHE_SIZE = 64;
const tableCache = new Map();

function foldOptions(head) {
  return {
    foldLength: head.foldLength ?? FOLD_LENGTH,
    foldMass: head.foldMass ?? 1,
    foldStiffness: head.foldStiffness ?? 1,
    foldDamping: head.foldDamping ?? 1,
  };
}

/**
 * Pitch (Hz) of the folds at a constant pressure and tension, measured
 * after the onset.
 * @param {number} pressure Lung pressure (Pa).
 * @param {number} tension Factor Q.
 * @param {object} [head] Head with the fold parameters.
 * @param {{duration?: number, window?: number, adduction?: number, rate?: number}} [options]
 */
export function foldPitch(pressure, tension, head = {}, options = {}) {
  const rate = options.rate ?? FOLD_RATE;
  const folds = new VocalFolds({ ...foldOptions(head), rate });
  const control = {
    voicing: 1,
    aspiration: 0,
    closure: 0,
    loudness: 1,
    lungPressure: pressure,
    adduction: options.adduction ?? TABLE_ADDUCTION,
    foldTension: tension,
  };
  const total = Math.round((options.duration ?? TABLE_DURATION) * rate);
  const window = Math.round((options.window ?? TABLE_WINDOW) * rate);
  const flow = new Float64Array(window);
  for (let index = 0; index < total; index++) {
    folds.step(1 / rate, control, 0);
    if (index >= total - window) {
      flow[index - total + window] = folds.flow;
    }
  }
  return flowPitch(flow, rate);
}

/** Measured pitch for every pressure (rows) and tension (columns). */
function pitchTable(head) {
  const options = foldOptions(head);
  const key = Object.values(options).join(':');
  let table = tableCache.get(key);
  if (!table) {
    table = TENSION_TABLE_PRESSURES.map((pressure) =>
      TENSION_TABLE_TENSIONS.map((tension) =>
        foldPitch(pressure, tension, options)
      )
    );
    if (tableCache.size >= TABLE_CACHE_SIZE) {
      tableCache.delete(tableCache.keys().next().value);
    }
    tableCache.set(key, table);
  }
  return table;
}

/** Tension of one table row for a pitch: linear between measured points. */
function rowTension(pitches, f0) {
  let previous = -1;
  for (let index = 0; index < pitches.length; index++) {
    const pitch = pitches[index];
    if (!(pitch > 0)) {
      continue;
    }
    if (pitch >= f0) {
      if (previous < 0) {
        return TENSION_TABLE_TENSIONS[index];
      }
      const q0 = TENSION_TABLE_TENSIONS[previous];
      const q1 = TENSION_TABLE_TENSIONS[index];
      const p0 = pitches[previous];
      return q0 + ((q1 - q0) * (f0 - p0)) / (pitch - p0);
    }
    previous = index;
  }
  return previous < 0 ? Number.NaN : TENSION_TABLE_TENSIONS[previous];
}

/**
 * Tension Q that makes the folds of a head vibrate at f0 (Hz) under a lung
 * pressure (Pa). The pitch is simulated once per head for Q from 0.4 to 5
 * and pressures of 400, 800 and 1600 Pa, then interpolated (in log
 * pressure between the rows, clamped to them).
 * @param {number} f0
 * @param {number} lungPressure
 * @param {object} [head]
 */
export function tensionForPitch(f0, lungPressure, head = {}) {
  const table = pitchTable(head);
  const pressures = TENSION_TABLE_PRESSURES;
  const pressure = Math.min(
    pressures.at(-1),
    Math.max(pressures[0], lungPressure)
  );
  let row = 1;
  while (row < pressures.length - 1 && pressure > pressures[row]) {
    row++;
  }
  const lower = rowTension(table[row - 1], f0);
  const upper = rowTension(table[row], f0);
  const weight =
    Math.log(pressure / pressures[row - 1]) /
    Math.log(pressures[row] / pressures[row - 1]);
  let tension;
  if (Number.isNaN(lower)) {
    tension = upper;
  } else if (Number.isNaN(upper)) {
    tension = lower;
  } else {
    tension = lower + (upper - lower) * weight;
  }
  return Number.isNaN(tension) ? 1 : clampTension(tension);
}
