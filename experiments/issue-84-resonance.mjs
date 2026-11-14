/**
 * Issue 84: lowest resonance of static [a] and [m] (mid-segment shapes of
 * ˈama) in the chain-matrix tube model with the nasal branch and in the
 * waveguide impulse response (0.25 s): frequency, peak gain and -3 dB
 * bandwidth, plus the 50 Hz gain.
 *
 *   node experiments/issue-84-resonance.mjs '{"nasalLoss":3}' [noseLossScale]
 */
import { planUtterance } from '../src/articulation/plan.js';
import {
  noseShape,
  sampleState,
  tractShape,
} from '../src/articulation/tract-shape.js';
import { normalizeHeadConfig } from '../src/head-config.js';
import { Waveguide, piriformBranch } from '../src/acoustics/waveguide.js';
import { SPEED_OF_SOUND, tubeTransfer } from '../src/acoustics/transfer.js';

export function staticShape(kind, head, sections = 44) {
  const plan = planUtterance('ˈama', { head });
  const segment = plan.segments.find((item) => item.kind === kind);
  const state = sampleState(plan, (segment.start + segment.end) / 2, {});
  return tractShape(state, head, { sections, teeth: true });
}

/** Lowest peak above `from` Hz: [frequency, gain dB, -3 dB bandwidth]. */
export function lowestPeak(frequencies, power, from = 100) {
  for (let index = 1; index < power.length - 1; index++) {
    if (frequencies[index] < from) {
      continue;
    }
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
    return [
      frequencies[index],
      10 * Math.log10(power[index]),
      frequencies[high] - frequencies[low],
    ];
  }
  return [NaN, NaN, NaN];
}

export function impulseSpectrum(response, rate, frequencies) {
  return frequencies.map((frequency) => {
    let re = 0;
    let im = 0;
    const turn = (2 * Math.PI * frequency) / rate;
    for (let index = 0; index < response.length; index++) {
      re += response[index] * Math.cos(turn * index);
      im -= response[index] * Math.sin(turn * index);
    }
    return re * re + im * im;
  });
}

export function waveguideResponse(shape, head, seconds = 0.25) {
  const nose = noseShape(head);
  const noseSections = Math.max(
    6,
    Math.round((44 * nose.length) / head.vocalTractLength)
  );
  const solver = new Waveguide({ sections: 44, noseSections, head });
  solver.setNose(nose.areas);
  solver.setShape(shape.areas, shape.velumArea, shape.velumIndex, shape.teeth);
  solver.setLength(shape.length);
  const rate = (44 * SPEED_OF_SOUND) / shape.length;
  const response = new Float64Array(Math.round(seconds * rate));
  for (let index = 0; index < response.length; index++) {
    response[index] = solver.step(index === 0 ? 1 : 0, 0, 0);
  }
  return { response, rate, noseSections };
}

export function tubeOptions(shape, head, noseLoss) {
  const nose = noseShape(head);
  return {
    branches: [piriformBranch(44, shape.length, head)],
    nose: {
      areas: nose.areas,
      length: nose.length,
      velumArea: shape.velumArea,
      velumIndex: shape.velumIndex,
      loss: noseLoss,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const head = normalizeHeadConfig(JSON.parse(process.argv[2] ?? '{}'));
  const noseLoss = process.argv[3] ? 2e-5 * Number(process.argv[3]) : undefined;
  const frequencies = [];
  for (let f = 40; f <= 3000; f += 2) {
    frequencies.push(f);
  }
  for (const kind of ['vowel', 'consonant']) {
    const shape = staticShape(kind, head);
    const options = tubeOptions(shape, head, noseLoss);
    const tube = frequencies.map(
      (f) => tubeTransfer(shape.areas, shape.length, f, options) ** 2
    );
    const { response, rate } = waveguideResponse(shape, head);
    const wave = impulseSpectrum(response, rate, frequencies);
    const fmt = (peak) => peak.map((v) => v.toFixed(1)).join(' ');
    console.log(
      `${kind} velum ${shape.velumArea.toFixed(2)} index ${shape.velumIndex}` +
        ` | tube peak ${fmt(lowestPeak(frequencies, tube))}` +
        ` 50Hz ${(10 * Math.log10(tube[5])).toFixed(1)}` +
        ` | waveguide peak ${fmt(lowestPeak(frequencies, wave))}` +
        ` 50Hz ${(10 * Math.log10(wave[5])).toFixed(1)}`
    );
  }
}
