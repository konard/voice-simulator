/** Acoustic features of the simulator's articulatory codebook (issue 64). */
import { AIR_DENSITY, SPEED_OF_SOUND } from '../acoustics/constants.js';
import {
  LOSS_SHAPE,
  WALL_MASS,
  WALL_RESISTANCE,
  WALL_STIFFNESS,
  constrictionLoss,
  viscothermalLoss,
} from '../acoustics/losses.js';
import { RADIATION_BAFFLE } from '../acoustics/radiation.js';
import { lpcBurg, lpcLevel } from './lpc.js';
import { CHANNEL_DEFAULTS } from '../articulation/plan.js';
import { renderPlan } from '../acoustics/voice.js';
import { whisperReferenceLpc } from './whisper-spectrum.js';

export const L0 = 16.5;
export const CODEBOOK_CHANNELS = Object.freeze(
  [
    ['height', 0, 1],
    ['backness', 0, 1],
    ['rounding', 0, 1],
    ['rhotic', 0, 1],
    ['palatalization', -1, 1],
    ['lipAmount', 0, 1],
    ['lipArea', 0, 2],
    ['tongueAmount', 0, 1],
    ['tongueArea', 0, 2],
    ['tongueLocation', 0, 1],
    ['tongueWidth', 0.02, 0.08],
    ['velum', 0, 1],
  ].map(([name, min, max]) => Object.freeze({ name, min, max }))
);
const mel = (f) => 2595 * Math.log10(1 + f / 700);
const hz = (m) => 700 * (10 ** (m / 2595) - 1);
export const GRID = Float64Array.from({ length: 24 }, (_, i) =>
  i < 16
    ? hz(mel(150) + (i * (mel(2700) - mel(150))) / 15)
    : hz(mel(2700) + ((i - 15) * (mel(5200) - mel(2700))) / 8)
);
export const RESPONSE_GRID = Float64Array.from(
  { length: 205 },
  (_, i) => 100 + 25 * i
);
const COSINES = Float64Array.from({ length: 96 }, (_, i) =>
  Math.cos((Math.PI * (1 + Math.floor(i / 16)) * ((i % 16) + 0.5)) / 16)
);
let sectionScratch = new Float64Array(44 * 4);

/**
 * The oral chain of tubeTransfer, evaluated with scalar complex arithmetic.
 * Propagate the lip load backwards: the matrix product acts on [Z_lips, 1].
 * No branches; the codebook measures open velums with the renderer.
 */
export function tractResponse(areas, length, frequencies, out) {
  const n = areas.length;
  if (!n || !(length > 0) || out.length < frequencies.length) {
    throw new RangeError('Invalid tract response dimensions');
  }
  if (sectionScratch.length < n * 4) {
    sectionScratch = new Float64Array(n * 4);
  }
  const s = sectionScratch;
  const dx = length / n;
  const rhoC = AIR_DENSITY * SPEED_OF_SOUND;
  for (let j = 0; j < n; j++) {
    const area = Math.max(areas[j], 1e-4);
    s[j * 4] = area;
    s[j * 4 + 1] = dx / Math.sqrt(area);
    s[j * 4 + 2] = (constrictionLoss(area) * 44) / n;
    s[j * 4 + 3] = 2 * Math.sqrt(Math.PI * area) * dx * rhoC;
  }
  const lipArea = Math.max(areas[n - 1], 1e-3);
  const radius = Math.sqrt(lipArea / Math.PI);
  for (let i = 0; i < frequencies.length; i++) {
    const f = frequencies[i];
    const omega = 2 * Math.PI * f;
    const phase = (omega * dx) / SPEED_OF_SOUND;
    const co = Math.cos(phase),
      si = Math.sin(phase);
    const loss = viscothermalLoss(f, 1, LOSS_SHAPE);
    const reactance = omega * WALL_MASS - WALL_STIFFNESS / omega;
    const wallScale = 1 / (WALL_RESISTANCE ** 2 + reactance ** 2);
    const ka = (omega * radius) / SPEED_OF_SOUND;
    let pr = (((ka * ka) / 2) * (0.5 + 0.5 * RADIATION_BAFFLE)) / lipArea;
    let pi = (ka * (0.61 + 0.24 * RADIATION_BAFFLE)) / lipArea;
    let ur = 1,
      ui = 0;
    for (let j = n - 1; j >= 0; j--) {
      const offset = j * 4;
      const area = s[offset];
      const scale = s[offset + 3] * wallScale;
      const yr = WALL_RESISTANCE * scale,
        yi = -reactance * scale;
      ur += pr * yr - pi * yi;
      ui += pr * yi + pi * yr;
      const e = Math.exp(loss * s[offset + 1] + s[offset + 2]);
      const ch = (e + 1 / e) / 2,
        sh = (e - 1 / e) / 2;
      const cr = co * ch,
        ci = si * sh;
      const br = co * sh,
        bi = si * ch;
      const nextPr = cr * pr - ci * pi + (br * ur - bi * ui) / area;
      const nextPi = cr * pi + ci * pr + (br * ui + bi * ur) / area;
      const nextUr = (br * pr - bi * pi) * area + cr * ur - ci * ui;
      ui = (br * pi + bi * pr) * area + cr * ui + ci * ur;
      pr = nextPr;
      pi = nextPi;
      ur = nextUr;
    }
    out[i] = -10 * Math.log10(ur * ur + ui * ui);
  }
  return out;
}

/** Remove level; absent high bands stay absent. */
export function normalizeEnvelope(envelope) {
  let sum = 0,
    count = 0;
  for (let i = 0; i < 16; i++) {
    if (Number.isFinite(envelope[i])) {
      sum += envelope[i];
      count++;
    }
  }
  const mean = count ? sum / count : 0;
  for (let i = 0; i < 24; i++) {
    envelope[i] -= mean;
  }
  return envelope;
}

/** Six DCT coefficients after removing the least-squares line. */
export function envelopeKey(envelope, out) {
  let last = 0;
  for (let i = 0; i < 16; i++) {
    if (Number.isFinite(envelope[i])) {
      last = envelope[i];
    }
  }
  let sum = 0,
    slope = 0;
  for (let i = 0; i < 16; i++) {
    const v = Number.isFinite(envelope[i]) ? envelope[i] : last;
    sum += v;
    slope += (i - 7.5) * v;
  }
  slope /= 340;
  for (let n = 0; n < 6; n++) {
    let value = 0;
    for (let i = 0; i < 16; i++) {
      const v = Number.isFinite(envelope[i]) ? envelope[i] : last;
      value += (v - sum / 16 - slope * (i - 7.5)) * COSINES[n * 16 + i];
    }
    out[n] = value;
  }
  return out;
}

export function interpolateResponse(response, frequency) {
  const x = Math.max(0, Math.min(response.length - 1, (frequency - 100) / 25));
  const i = Math.min(response.length - 2, Math.floor(x));
  return response[i] + (response[i + 1] - response[i]) * (x - i);
}

/** First four peaks and their interpolated -3 dB bandwidths, in Hz. */
export function responseFormants(response, out) {
  out.fill(0);
  let found = 0;
  for (let i = 1; i < response.length - 1 && found < 4; i++) {
    const a = response[i - 1],
      b = response[i],
      c = response[i + 1];
    if (!(b > a && b >= c)) {
      continue;
    }
    const delta = (0.5 * (a - c)) / (a - 2 * b + c);
    const peak = b - 0.25 * (a - c) * delta;
    const target = peak - 3;
    let left = i,
      right = i;
    while (left > 0 && response[left] > target) {
      left--;
    }
    while (right < response.length - 1 && response[right] > target) {
      right++;
    }
    out[found] = 100 + 25 * (i + delta);
    if (response[left] <= target && response[right] <= target) {
      const low =
        left +
        (target - response[left]) / (response[left + 1] - response[left]);
      const high =
        right -
        1 +
        (target - response[right - 1]) /
          (response[right] - response[right - 1]);
      out[found + 4] = 25 * (high - low);
    }
    found++;
  }
  return out;
}

/** Constant source channels, with every control array filled exactly once. */
export function steadyPlan(state, duration = 0.08) {
  const frameCount = Math.round(duration * 200) + 1;
  const values = { ...CHANNEL_DEFAULTS, ...state, f0: 100 };
  return {
    frameRate: 200,
    frameCount,
    duration,
    segments: [],
    tokens: [],
    channels: Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        new Float32Array(frameCount).fill(value),
      ])
    ),
  };
}

/** Order 18, with Burg LPC for voice and five-frame autocorrelation for whisper. */
export function renderedResponse(
  state,
  head,
  out,
  frequencies = RESPONSE_GRID,
  engine = 'js'
) {
  const samples = renderPlan(steadyPlan(state), {
    head,
    solver: 'waveguide',
    sampleRate: 16000,
    seed: 1,
    engine,
  });
  const a = new Float64Array(18),
    k = new Float64Array(18);
  const power = state.whisper
    ? whisperReferenceLpc(samples, 16000, 18, a, k)
    : steadyBurg(samples, a, k);
  for (let i = 0; i < out.length; i++) {
    out[i] = lpcLevel(a, 18, power, frequencies[i], 16000);
  }
  return out;
}

/** Burg envelope of the last 40 ms, pre-emphasis 0.97. */
function steadyBurg(samples, a, k) {
  const x = new Float64Array(640);
  const start = samples.length - x.length;
  for (let i = 0; i < x.length; i++) {
    x[i] = samples[start + i] - 0.97 * (samples[start + i - 1] ?? 0);
  }
  return lpcBurg(x, a.length, a, k);
}
