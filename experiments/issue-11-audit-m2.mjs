// Extra measurements for the milestone M2 plan of issue 11: root causes of
// the `breathiness` bug (P20) and of the loud nasals in the 3D solver (P72),
// and the present values that P22 and P24 start from.
// Run: node experiments/issue-11-audit-m2.mjs > experiments/issue-11-audit-m2.txt
import {
  synthesize,
  analyzeVoice,
  planUtterance,
  normalizeHeadConfig,
  VoiceRenderer,
  Glottis,
  Waveguide,
  Fdtd3d,
  sampleState,
  tractShape,
  noseShape,
} from '../src/index.js';
import { SPEED_OF_SOUND, tubeFormants } from '../src/acoustics/transfer.js';
import { Biquad, createNoise } from '../src/acoustics/filters.js';
import { LINK_LIPS, LINK_NOSTRILS } from '../src/acoustics/voxel-model.js';
import {
  closedPortLeak,
  murmurResonance,
  portAreas,
  referenceResonances,
} from './issue-84-port-3d.mjs';
import { leakSpectrum } from './issue-84-leak-spectrum.mjs';

const show = (label, value) =>
  console.log(`${label}: ${JSON.stringify(value)}`);
const round = (value, digits = 2) => Number(value.toFixed(digits));
const decibels = (ratio) => round(20 * Math.log10(ratio));
const rootMeanSquare = (values, from = 0, to = values.length) => {
  let sum = 0;
  for (let index = from; index < to; index++) {
    sum += values[index] ** 2;
  }
  return Math.sqrt(sum / Math.max(1, to - from));
};

// --- P20 -----------------------------------------------------------------

// 1. The source alone: level of the breath noise against the pulse train.
// Two glottises with the same seed and breathiness get the same pulses (the
// pulse shape depends on breathiness since issue 32); one gets the noise
// and the other none, so their difference is the noise that `breathiness`
// adds.
const RATE = 48000;
const control = { f0: 120, voicing: 1, aspiration: 0, closure: 0, loudness: 1 };
function sourceNoise(breathiness) {
  const make = () => new Glottis({ seed: 1, tenseness: 0.6, breathiness });
  const clean = make();
  const breathy = make();
  const white = createNoise('m2:noise');
  const band = new Biquad();
  band.bandpass(800, 0.5, RATE);
  const pulses = new Float64Array(RATE);
  const noise = new Float64Array(RATE);
  for (let index = 0; index < RATE; index++) {
    const sample = band.process(white());
    pulses[index] = clean.step(1 / RATE, control, 0);
    noise[index] = breathy.step(1 / RATE, control, sample) - pulses[index];
  }
  return decibels(rootMeanSquare(noise) / rootMeanSquare(pulses));
}
for (const breathiness of [0.2, 0.5, 1]) {
  show(`source noise re pulses, breathiness ${breathiness}`, {
    dB: sourceNoise(breathiness),
  });
}

// 2. What the analysis measures on a steady vowel and on a sentence when
// one source parameter changes.
const sentence =
  'Please call Stella and ask her to bring these things with her.';
const steady = { vibrato: 0, jitter: 0, shimmer: 0 };
function measure(label, text, options, head) {
  const { samples, sampleRate } = synthesize(text, {
    tier: 'medium',
    seed: 1,
    ...options,
    head,
  });
  const features = analyzeVoice(samples, sampleRate);
  show(label, { hnr: round(features.hnr), h1h2: round(features.h1h2) });
}
for (const breathiness of [0, 0.5, 1]) {
  measure(
    `steady [aː], no jitter/shimmer/vibrato, breathiness ${breathiness}`,
    'aː',
    { ipa: true },
    { ...steady, breathiness }
  );
}
measure(
  'sentence, no jitter/shimmer/vibrato, breathiness 0',
  sentence,
  {},
  { ...steady, breathiness: 0 }
);
for (const tenseness of [0.2, 0.6, 0.9]) {
  measure(
    `steady [aː], tenseness ${tenseness}`,
    'aː',
    { ipa: true },
    {
      ...steady,
      breathiness: 0,
      tenseness,
    }
  );
}
measure(
  'steady [aː], breathiness 1 and aspirationLevel 3',
  'aː',
  { ipa: true },
  { ...steady, breathiness: 1, aspirationLevel: 3 }
);
measure(
  'steady [aː], breathiness 1 and glottalChink 10',
  'aː',
  { ipa: true },
  { ...steady, breathiness: 1, glottalChink: 10 }
);

// 2b. The ceiling of the HNR estimate: perfectly periodic sums of harmonics
// (amplitude 1/k up to 5 kHz) with no noise at all. The period is a whole
// number of analysis samples at 110.25 Hz (100 samples at 11025 Hz) and
// falls between two samples at 120 Hz (91.875 samples). The last signal
// glides from 126 to 114 Hz in one second, like a falling sentence.
function harmonicSignal(pitchAt) {
  const samples = new Float32Array(RATE);
  let phase = 0;
  for (let index = 0; index < RATE; index++) {
    const f0 = pitchAt(index / RATE);
    phase += (2 * Math.PI * f0) / RATE;
    let sum = 0;
    for (let k = 1; k * f0 < 5000; k++) {
      sum += Math.sin(k * phase) / k;
    }
    samples[index] = 0.2 * sum;
  }
  return samples;
}
for (const [label, pitchAt] of [
  ['110.25 Hz', () => 110.25],
  ['120 Hz', () => 120],
  ['gliding 126 to 114 Hz', (time) => 126 - 12 * time],
]) {
  const features = analyzeVoice(harmonicSignal(pitchAt), RATE);
  show(`noise-free harmonic signal, ${label}`, { hnr: round(features.hnr) });
}

// 2c. The same steady vowel with the pitch movement taken out of the plan.
{
  const flat = { ...steady, breathiness: 0, declination: 0, accentStrength: 0 };
  const plan = planUtterance('aː', { head: normalizeHeadConfig(flat) });
  const voiced = Array.from(plan.channels.f0).filter((value) => value > 0);
  show('planned f0 of [aː], default prosody', {
    ...(() => {
      const normal = planUtterance('aː', {
        head: normalizeHeadConfig({ ...steady, breathiness: 0 }),
      });
      const f0 = Array.from(normal.channels.f0).filter((value) => value > 0);
      return { from: round(f0[0], 1), to: round(f0.at(-1), 1) };
    })(),
    seconds: round(plan.duration),
  });
  show('planned f0 of [aː], declination 0 and accentStrength 0', {
    from: round(voiced[0], 1),
    to: round(voiced.at(-1), 1),
  });
  measure(
    'steady [aː], breathiness 0, declination 0 and accentStrength 0',
    'aː',
    { ipa: true },
    flat
  );
  for (const breathiness of [0, 1]) {
    measure(
      `steady [aː], pitchRange 0.5, breathiness ${breathiness}`,
      'aː',
      { ipa: true },
      { ...flat, pitchRange: 0.5, breathiness }
    );
  }
}

// --- P72 -----------------------------------------------------------------

// 3. [ˈama] per solver: level of the flow through the lips and through the
// nostrils (solver units, before the output filters) in the middle of the
// first vowel and of the nasal, and the level of the final audio.
function nasalLevels(label, options, head = {}) {
  const plan = planUtterance('ˈama', { head: normalizeHeadConfig(head) });
  const renderer = new VoiceRenderer(plan, { seed: 1, ...options });
  const { solver } = renderer;
  const lips = [];
  const nose = [];
  const times = [];
  const step = solver.step.bind(solver);
  let time = 0;
  solver.step = (...step_) => {
    const output = step(...step_);
    if (solver.outputLinks) {
      let lipFlow = 0;
      let noseFlow = 0;
      for (let index = 0; index < solver.outputLinks.length; index++) {
        const link = solver.outputLinks[index];
        const flow =
          solver.outputSigns[index] *
          solver.conductance[link] *
          solver.velocity[link] *
          solver.dx ** 2;
        if (solver.linkKind[link] === LINK_LIPS) {
          lipFlow += flow;
        } else if (solver.linkKind[link] === LINK_NOSTRILS) {
          noseFlow += flow;
        }
      }
      lips.push(lipFlow);
      nose.push(noseFlow);
    } else {
      lips.push(solver.lipOutput);
      nose.push(solver.noseOutput);
    }
    time += renderer.stepDuration;
    times.push(time);
    return output;
  };
  const samples = new Float32Array(renderer.totalSamples);
  renderer.render(samples);
  const window = (values, centre, rate) => {
    if (rate) {
      return rootMeanSquare(
        values,
        Math.floor((centre - 0.015) * rate),
        Math.floor((centre + 0.015) * rate)
      );
    }
    const from = times.findIndex((value) => value >= centre - 0.015);
    const to = times.findIndex((value) => value >= centre + 0.015);
    return rootMeanSquare(values, from, to);
  };
  const centre = (kind) => {
    const segment = plan.segments.find((item) => item.kind === kind);
    return (segment.start + segment.end) / 2;
  };
  const vowel = centre('vowel');
  const nasal = centre('consonant');
  const rate = renderer.sampleRate;
  show(label, {
    vowelLips: round(window(lips, vowel), 4),
    vowelNose: round(window(nose, vowel), 4),
    nasalLips: round(window(lips, nasal), 4),
    nasalNose: round(window(nose, nasal), 4),
    audioVowel: round(window(samples, vowel, rate), 4),
    audioNasal: round(window(samples, nasal, rate), 4),
    ratio: round(window(samples, nasal, rate) / window(samples, vowel, rate)),
  });
}
const waveguide = { solver: 'waveguide', sections: 44 };
const voxels = { solver: 'fdtd3d', dx: 1 };
nasalLevels('ama waveguide 44', waveguide);
nasalLevels('ama fdtd3d dx 1', voxels);
nasalLevels('ama fdtd3d dx 0.6', { solver: 'fdtd3d', dx: 0.6 });
for (const nasalCoupling of [0.25, 0.5, 2]) {
  nasalLevels(`ama waveguide 44, nasalCoupling ${nasalCoupling}`, waveguide, {
    nasalCoupling,
  });
  nasalLevels(`ama fdtd3d dx 1, nasalCoupling ${nasalCoupling}`, voxels, {
    nasalCoupling,
  });
}
for (const wallLoss of [0, 3]) {
  nasalLevels(`ama waveguide 44, wallLoss ${wallLoss}`, waveguide, {
    wallLoss,
  });
  nasalLevels(`ama fdtd3d dx 1, wallLoss ${wallLoss}`, voxels, { wallLoss });
}
nasalLevels('ama fdtd3d dx 1, no pouches', {
  ...voxels,
  piriform: false,
  vallecula: false,
});
nasalLevels('ama fdtd3d dx 1, microphone output', {
  ...voxels,
  output: 'microphone',
});

// 4. Velar port area (cm²) in the middle of the vowel and of the nasal, and
// the nose flow of a vowel that has no nasal next to it.
{
  const head = normalizeHeadConfig({});
  const plan = planUtterance('ˈama', { head });
  const areaAt = (kind) => {
    const segment = plan.segments.find((item) => item.kind === kind);
    const state = sampleState(plan, (segment.start + segment.end) / 2, {});
    return round(tractShape(state, head, { sections: 44 }).velumArea, 4);
  };
  show('ama velar port area', {
    vowel: areaAt('vowel'),
    nasal: areaAt('consonant'),
    firstNoseSection: round(noseShape(head).areas[0], 2),
  });
}

// 5. Static shapes: gain from the glottal flow to the radiated flow (lips
// plus nostrils) from the impulse response, per solver. At frequencies far
// below the first resonance the air cannot be stored anywhere, so a closed
// mouth with an open velar port must pass the same flow as an open mouth.
function transferGains(label, makeSolver, kind) {
  const head = normalizeHeadConfig({});
  const plan = planUtterance('ˈama', { head });
  const segment = plan.segments.find((item) => item.kind === kind);
  const state = sampleState(plan, (segment.start + segment.end) / 2, {});
  const shape = tractShape(state, head, { sections: 44, teeth: true });
  const solver = makeSolver(head);
  solver.setNose(noseShape(head).areas);
  solver.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
  const rate = solver.stepDuration
    ? 1 / solver.stepDuration(shape)
    : (44 * SPEED_OF_SOUND) / shape.length;
  const count = Math.round(0.3 * rate);
  const response = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    response[index] = solver.step(index === 0 ? 1 : 0, 0, 0);
  }
  const gains = {};
  for (const frequency of [50, 100, 250, 500, 1000, 2000]) {
    let re = 0;
    let im = 0;
    for (let index = 0; index < count; index++) {
      const phase = (2 * Math.PI * frequency * index) / rate;
      re += response[index] * Math.cos(phase);
      im -= response[index] * Math.sin(phase);
    }
    gains[frequency] = decibels(Math.hypot(re, im));
  }
  show(`gain dB ${label} ${kind === 'vowel' ? '[a]' : '[m]'}`, gains);
}
const nose = (head) =>
  Math.max(
    6,
    Math.round((44 * noseShape(head).length) / head.vocalTractLength)
  );
for (const kind of ['vowel', 'consonant']) {
  transferGains(
    'waveguide 44',
    (head) => new Waveguide({ sections: 44, noseSections: nose(head), head }),
    kind
  );
  transferGains('fdtd3d dx 1', (head) => new Fdtd3d({ head, dx: 1 }), kind);
}

// 5b. Issue 84, step 4: the velar port and the nostrils of the 3D solver
// for a static [m] against the areas they should have (effective area =
// sum of conductance * dx² over the links), the lowest resonance of [m]
// (impulse response, 0.25 s: frequency Hz, gain dB, -3 dB bandwidth Hz)
// against the tube model with the nasal branch and the waveguide, and the
// nostril flow of [a] with a closed port (RMS of the impulse response, and
// nostrils minus lips in dB per band).
show(
  '[m] lowest resonance, references',
  referenceResonances(normalizeHeadConfig({}))
);
for (const dx of [1, 0.6, 0.5]) {
  const { solver, shape, result } = portAreas(dx, [0.3, 0.8, 1.3]);
  for (const row of result) {
    show(`fdtd3d dx ${dx} velar port and nostrils`, row);
  }
  show(`fdtd3d dx ${dx} [m] lowest resonance`, murmurResonance(solver, shape));
  const leak = closedPortLeak(dx);
  show(`fdtd3d dx ${dx} [a] closed port`, {
    lips: round(leak.lips, 4),
    nostrils: round(leak.nostrils, 4),
    ratio: round(leak.nostrils / leak.lips),
    bands: leakSpectrum(dx),
  });
}

// --- P24 -----------------------------------------------------------------

// 6. Formant frequencies and -3 dB bandwidths (Hz) of static vowels in the
// waveguide, from the impulse response, with the default glottis and with a
// closed (fully reflecting) glottis.
function bandwidths(ipa, reflection) {
  const head = normalizeHeadConfig({});
  const plan = planUtterance(ipa, { head });
  const segment = plan.segments.find((item) => item.kind === 'vowel');
  const state = sampleState(plan, (segment.start + segment.end) / 2, {});
  const shape = tractShape(state, head, { sections: 44, teeth: true });
  const solver = new Waveguide({
    sections: 44,
    noseSections: nose(head),
    head,
  });
  solver.setNose(noseShape(head).areas);
  solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth);
  solver.setLength(shape.length);
  if (reflection !== undefined) {
    solver.glottalReflection = reflection;
  }
  const rate = (44 * SPEED_OF_SOUND) / shape.length;
  const count = Math.round(0.25 * rate);
  const response = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    response[index] = solver.step(index === 0 ? 1 : 0, 0, 0);
  }
  const step = 4;
  const power = [];
  for (let frequency = 150; frequency <= 3600; frequency += step) {
    let re = 0;
    let im = 0;
    const turn = (2 * Math.PI * frequency) / rate;
    for (let index = 0; index < count; index++) {
      re += response[index] * Math.cos(turn * index);
      im -= response[index] * Math.sin(turn * index);
    }
    power.push(re * re + im * im);
  }
  const formants = [];
  for (let index = 1; index < power.length - 1; index++) {
    if (power[index] <= power[index - 1] || power[index] < power[index + 1]) {
      continue;
    }
    let low = index;
    let high = index;
    while (low > 0 && power[low] > power[index] / 2) {
      low--;
    }
    while (high < power.length - 1 && power[high] > power[index] / 2) {
      high++;
    }
    formants.push([150 + index * step, (high - low) * step]);
  }
  return formants.slice(0, 3);
}
for (const ipa of ['ɑ', 'i', 'u']) {
  show(`formant and bandwidth, waveguide [${ipa}]`, {
    defaultGlottis: bandwidths(ipa),
    closedGlottis: bandwidths(ipa, 1),
  });
}

// --- P22 -----------------------------------------------------------------

// 7. Resonances (Hz) of two candidate subglottal area functions seen from
// the glottis: a trachea of constant area, then an exponential flare that
// stands for the bronchi. Sections are listed from the glottis downwards.
for (const [trachea, area, flare, end] of [
  [10, 2.5, 8, 20],
  [10, 1.5, 10, 20],
]) {
  const sections = 40;
  const total = trachea + flare;
  const areas = Float64Array.from({ length: sections }, (_, index) => {
    const x = ((index + 0.5) / sections) * total;
    return x < trachea ? area : area * (end / area) ** ((x - trachea) / flare);
  });
  show(
    `subglottal resonances, trachea ${trachea} cm of ${area} cm², flare ${flare} cm to ${end} cm²`,
    tubeFormants(areas, total, {}).slice(0, 3).map(Math.round)
  );
}
