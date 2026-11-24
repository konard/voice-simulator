/**
 * 3D FDTD solver on the sparse voxel model: geometry, resonances, levels
 * and determinism. Uses coarse 1 cm cells so every runtime stays fast.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  CELL_AIR,
  CELL_NOSE,
  CELL_SINUS,
  CELL_TRACT,
  LINK_LIPS,
  LINK_NOSTRILS,
  LINK_SINUS,
  LINK_VELUM,
  buildVoxelModel,
} from '../src/acoustics/voxel-model.js';
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { Waveguide } from '../src/acoustics/waveguide.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { rms, spectralPeaks } from '../src/acoustics/analysis.js';
import { SPEED_OF_SOUND, tubeFormants } from '../src/acoustics/transfer.js';
import { planUtterance } from '../src/articulation/plan.js';
import { vowelTarget } from '../src/articulation/phones.js';
import {
  noseShape,
  sampleState,
  tractShape,
} from '../src/articulation/tract-shape.js';
import {
  DEFAULT_HEAD,
  presetHeadConfig,
  randomHeadConfig,
} from '../src/head-config.js';
import { VOWEL_CORRECTIONS_3D } from '../src/articulation/vowel-calibration.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import {
  STORY_FEATURES,
  VOWEL_LENGTH_SCALE_3D,
  tableLengthScale,
} from '../src/articulation/vowel-space.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { synthesize } from '../src/index.js';
import { itUnless } from './helpers/skip.js';

const DX = 1;
const RATE = 16000;
const model = buildVoxelModel(DEFAULT_HEAD, { dx: DX });
/** The same grid without the piriform fossae and the vallecula. */
const bare = buildVoxelModel(DEFAULT_HEAD, {
  dx: DX,
  piriform: false,
  vallecula: false,
});

function vowelShape(symbol) {
  return tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(symbol) }), rhotic: 0 },
    DEFAULT_HEAD
  );
}

/** Why the murmur stays above half the level of the vowel. */
const NASAL_TARGET_BLOCKED =
  'blocked: the first harmonic of the vowel puts a floor near 0.71 (experiments/issue-84-first-harmonic.mjs)';

/**
 * RMS of the [m] of ˈama over 30 ms in its middle, divided by that of the
 * first [a].
 */
function nasalRatio(tier) {
  const { samples, sampleRate, plan } = synthesize('ˈama', {
    ipa: true,
    tier,
    seed: 1,
  });
  const level = (kind) => {
    const segment = plan.segments.find((item) => item.kind === kind);
    const centre = Math.round(((segment.start + segment.end) / 2) * sampleRate);
    const half = Math.round(0.015 * sampleRate);
    return rms(samples, centre - half, centre + half);
  };
  return level('consonant') / level('vowel');
}

/** Sum of conductance * dx² over the links of one kind (cm²). */
function linkArea(solver, kind) {
  let area = 0;
  for (let link = 0; link < solver.linkCount; link++) {
    if (solver.linkKind[link] === kind) {
      area += solver.conductance[link] * solver.dx ** 2;
    }
  }
  return area;
}

/** Spectral peaks (Hz) of a solver's impulse response. */
function responsePeaks(solver, rate, seconds = 0.06) {
  const response = new Float64Array(Math.round(rate * seconds));
  for (let n = 0; n < response.length; n++) {
    response[n] = solver.step(n === 0 ? 1 : 0, 0, 0);
  }
  return spectralPeaks(response, rate, { prominence: 0.5 });
}

/** Spectral peaks (Hz) of the 3D impulse response for a static vowel. */
function impulsePeaks(shape, voxels = bare) {
  const solver = new Fdtd3d({ model: voxels });
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  solver.setShape(shape.areas, 0);
  return responsePeaks(solver, 1 / solver.stepDuration(shape));
}

/** Spectral peaks (Hz) of the waveguide impulse response. */
function waveguidePeaks(areas, length, options = {}) {
  const solver = new Waveguide({ sections: areas.length, ...options });
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  solver.setShape(areas, 0);
  return responsePeaks(solver, (areas.length * SPEED_OF_SOUND) / length);
}

/** Air volume (cm³) and open area into the tract (cm²) of each pouch. */
function pouchAir(solver) {
  const { cells, links, sinuses } = solver.model;
  const air = new Map(
    sinuses.map((sinus) => [sinus.tube, { volume: 0, opening: 0 }])
  );
  cells.forEach((cell, index) => {
    if (cell.kind === CELL_SINUS) {
      air.get(cell.tube).volume += solver.fill[index] * DX ** 3;
    }
  });
  links.kind.forEach((kind, link) => {
    // The pouches open at the place of the glottis (see #placePouches).
    if (kind === LINK_SINUS && !solver.shut[link]) {
      const [a, b] = [links.a[link], links.b[link]];
      const pouch = cells[a].kind === CELL_SINUS ? cells[a] : cells[b];
      air.get(pouch.tube).opening +=
        Math.min(solver.fill[a], solver.fill[b]) * DX * DX;
    }
  });
  return air;
}

/** Channels in the middle of the vowel of `ipa`. */
function vowelFrame(ipa) {
  const plan = planUtterance(ipa);
  const segment = plan.segments.find((entry) => entry.kind === 'vowel');
  const frame = Math.round(
    ((segment.start + segment.end) / 2) * plan.frameRate
  );
  return { plan, frame };
}

/**
 * A voiced plan that holds the vowel of `from` for 0.15 s, glides to that
 * of `to` in `glide` seconds (every channel at once) and holds it 0.15 s.
 */
function glidePlan(from, to, glide, hold = 0.15) {
  const a = vowelFrame(from);
  const b = vowelFrame(to);
  const { frameRate } = a.plan;
  const frameCount = Math.round((glide + 2 * hold) * frameRate);
  const channels = {};
  for (const [name, values] of Object.entries(a.plan.channels)) {
    const start = values[a.frame];
    const end = b.plan.channels[name][b.frame];
    channels[name] = Float64Array.from({ length: frameCount }, (_, frame) => {
      const t = Math.min(1, Math.max(0, (frame / frameRate - hold) / glide));
      return start + (end - start) * t;
    });
  }
  const duration = frameCount / frameRate;
  const vowel = a.plan.segments.find((entry) => entry.kind === 'vowel');
  return {
    ...a.plan,
    segments: [{ ...vowel, start: 0, end: duration }],
    frameCount,
    duration,
    channels,
  };
}

/** Largest step between two samples over the RMS, from `from` to `to`. */
function largestStep(samples, from, to) {
  let largest = 0;
  for (let n = from + 1; n < to; n++) {
    largest = Math.max(largest, Math.abs(samples[n] - samples[n - 1]));
  }
  return largest / rms(samples, from, to);
}

function relativeError(value, target) {
  return Math.abs(value - target) / target;
}

describe('voxel model', () => {
  it('holds tract, nose and free air connected at lips, nostrils and velum', () => {
    const counts = [0, 0, 0, 0];
    for (const cell of model.cells) {
      counts[cell.kind]++;
    }
    expect(counts[CELL_TRACT]).toBeGreaterThan(100);
    expect(counts[CELL_NOSE]).toBeGreaterThan(20);
    expect(counts[CELL_AIR]).toBeGreaterThan(50);
    expect(counts[CELL_SINUS]).toBeGreaterThan(10);
    for (const kind of [LINK_LIPS, LINK_NOSTRILS, LINK_VELUM, LINK_SINUS]) {
      expect(
        model.links.kind.filter((value) => value === kind).length
      ).toBeGreaterThan(0);
    }
    const open = Array.from(model.openFaces).reduce((a, b) => a + b, 0);
    expect(open).toBeGreaterThan(0);
  });

  it('opens the pouches into the tract only at their upper end', () => {
    const names = model.sinuses.map((sinus) => sinus.name);
    expect(names.join()).toBe('piriform-left,piriform-right,vallecula');
    const opened = new Set();
    model.links.kind.forEach((kind, link) => {
      const a = model.cells[model.links.a[link]];
      const b = model.cells[model.links.b[link]];
      if (a.kind !== CELL_SINUS && b.kind !== CELL_SINUS) {
        return;
      }
      if (kind === LINK_SINUS) {
        const [pouch, tract] = a.kind === CELL_SINUS ? [a, b] : [b, a];
        expect(tract.kind).toBe(CELL_TRACT);
        expect(pouch.arc).toBeLessThan(1.5 * DX + 1e-9);
        opened.add(pouch.tube);
      } else {
        expect(a.tube).toBe(b.tube);
      }
    });
    expect(opened.size).toBe(3);
    // The openings ride along with the larynx: every place of the glottis
    // has its own links into the tract.
    const places = 2 * Math.floor(model.larynxTravel / DX + 1e-9) + 1;
    for (const sinus of model.sinuses) {
      expect(sinus.openings.length).toBe(places);
      for (const links of sinus.openings) {
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
          expect(model.links.kind[link]).toBe(LINK_SINUS);
        }
      }
    }
    expect(bare.cells.some((cell) => cell.kind === CELL_SINUS)).toBe(false);
    expect(bare.sinuses.length).toBe(0);
  });

  it('gives each pouch its anatomical volume and an open neck', () => {
    const solver = new Fdtd3d({ model });
    const shape = vowelShape('ə');
    solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth);
    const air = pouchAir(solver);
    for (const sinus of model.sinuses) {
      const { volume, opening } = air.get(sinus.tube);
      expect(relativeError(volume, sinus.area * sinus.length)).toBeLessThan(
        0.05
      );
      // A narrow neck would turn the pouch into a Helmholtz resonator.
      expect(opening).toBeGreaterThan(0.4 * sinus.area);
    }
  });

  it('keeps the nostrils from covering the mouth on a coarse grid', () => {
    // On this head the widened end of the nose tube reached below the upper
    // lip, sealed the incisor slot and left /i/ without its F1.
    const head = randomHeadConfig('ci-84');
    const voxels = buildVoxelModel(head, { dx: DX });
    const shape = tractShape(
      { ...vowelTarget({ phoneme: getPhoneme('i') }), rhotic: 0 },
      head,
      { vowelCorrections: VOWEL_CORRECTIONS_3D }
    );
    const solver = new Fdtd3d({ model: voxels });
    solver.setNose(noseShape(head).areas);
    solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth);
    const [f1] = responsePeaks(
      solver,
      1 / solver.stepDuration(shape),
      0.1
    ).filter((value) => value > 150);
    expect(f1).toBeLessThan(600);
  });

  it('gets finer with smaller cells', () => {
    const fine = buildVoxelModel(DEFAULT_HEAD, { dx: 0.8 });
    expect(fine.cells.length).toBeGreaterThan(model.cells.length);
  });
});

describe('3D FDTD resonances', () => {
  for (const symbol of ['ə', 'i', 'ɑ']) {
    it(`/${symbol}/ formants are within 20% of the tube model`, () => {
      const shape = vowelShape(symbol);
      const peaks = impulsePeaks(shape);
      // The 3D walls are rigid (losses in 3D are out of scope of issue
      // 36), so the reference is the tube with rigid walls.
      const [f1, f2] = tubeFormants(shape.areas, shape.length, {
        count: 2,
        walls: false,
      });
      expect(relativeError(peaks[0], f1)).toBeLessThan(0.2);
      const nearest = peaks.reduce((best, peak) =>
        Math.abs(peak - f2) < Math.abs(best - f2) ? peak : best
      );
      expect(relativeError(nearest, f2)).toBeLessThan(0.2);
    });
  }
});

describe('3D FDTD vowel table', () => {
  const head = presetHeadConfig('male');
  // The grid the table is fitted on (scripts/calibrate-vowels.mjs): a 1 cm
  // grid cannot resolve the lip constriction of /u/.
  const voxels = buildVoxelModel(head, { dx: 0.5 });

  /** F1-F3 (Hz) of a measured vowel on the male head, incisors included. */
  function maleFormants(name, vowelCorrections) {
    const [height, backness, rounding] = STORY_FEATURES[name];
    const shape = tractShape({ height, backness, rounding }, head, {
      vowelCorrections,
    });
    // As the synthesizer runs it: the source plane follows the length.
    const solver = new Fdtd3d({
      model: voxels,
      lengthScale: VOWEL_LENGTH_SCALE_3D,
    });
    solver.setNose(noseShape(head).areas);
    solver.setShape(
      shape.areas,
      shape.velumArea,
      shape.velumIndex,
      shape.teeth,
      shape
    );
    return responsePeaks(solver, 1 / solver.stepDuration(shape), 0.08)
      .filter((value) => value > 150)
      .slice(0, 3);
  }

  it('keeps the larynx of the table vowels near its rest place', () => {
    // The source plane sits at length / VOWEL_LENGTH_SCALE_3D; a table whose
    // lengths drift from that scale would move every vowel's glottis.
    const scale = tableLengthScale(VOWEL_CORRECTIONS_3D);
    expect(Math.abs(scale / VOWEL_LENGTH_SCALE_3D - 1)).toBeLessThan(0.03);
  });

  it('matches the mean vowel formants of men better than the tube table', () => {
    const error = (formants, targets) =>
      Math.sqrt(
        targets.reduce(
          (sum, target, index) => sum + Math.log(formants[index] / target) ** 2,
          0
        ) / targets.length
      );
    for (const name of ['i', 'ɑ', 'u']) {
      const targets = HILLENBRAND.male[name];
      const calibrated = error(
        maleFormants(name, VOWEL_CORRECTIONS_3D),
        targets
      );
      expect(calibrated).toBeLessThan(0.08);
      expect(calibrated).toBeLessThan(error(maleFormants(name), targets));
    }
  });
});

describe('3D FDTD geometry against the waveguide', () => {
  it('resonates like the waveguide in a uniform tube', () => {
    const areas = new Array(44).fill(3);
    const solver = new Fdtd3d({ model: bare });
    solver.setShape(areas, 0, undefined, null);
    const peaks = responsePeaks(solver, 1 / solver.stepDuration(), 0.08);
    const length = bare.lengths[CELL_TRACT];
    // Rigid walls as in 3D: yielding ones raise F1 of the closed tube.
    const reference = waveguidePeaks(areas, length, {
      piriform: false,
      walls: false,
    });
    for (const target of reference.slice(0, 3)) {
      const nearest = peaks.reduce((best, peak) =>
        Math.abs(peak - target) < Math.abs(best - target) ? peak : best
      );
      expect(relativeError(nearest, target)).toBeLessThan(0.12);
    }
  });

  it('lowers /ɑ/ F1 with the piriform fossae as much as the waveguide', () => {
    const shape = vowelShape('ɑ');
    const piriform = buildVoxelModel(DEFAULT_HEAD, {
      dx: DX,
      vallecula: false,
    });
    const [withFossae, without] = [true, false].map(
      (enabled) =>
        waveguidePeaks(shape.areas, shape.length, { piriform: enabled })[0]
    );
    // F1 is the 3D peak nearest the waveguide's: the nostrils pick up a
    // little of the radiated sound, which leaves sub-dB ripples below F1.
    const nearest = (peaks, target) =>
      peaks.reduce((best, peak) =>
        Math.abs(peak - target) < Math.abs(best - target) ? peak : best
      );
    const shift3d =
      nearest(impulsePeaks(shape, piriform), withFossae) /
      nearest(impulsePeaks(shape), without);
    const shift1d = withFossae / without;
    expect(shift1d).toBeLessThan(0.93);
    expect(shift3d).toBeLessThan(0.93);
    // The 3D fossae open along the bent MRI pharynx a little nearer the
    // glottis than the waveguide's branch and lower F1 a few per cent more.
    expect(Math.abs(shift3d - shift1d)).toBeLessThan(0.06);
  });

  it('keeps the nose still when the tract gets longer', () => {
    // [u] is 11 % longer than [æ]: the glottis end moves, and the time
    // step only takes the rest, under half a cell.
    const [u, ae] = ['u', 'æ'].map((symbol) => {
      const shape = vowelShape(symbol);
      const solver = new Fdtd3d({ model });
      solver.setShape(shape.areas, 0, shape.velumIndex, shape.teeth, shape);
      return { shape, solver, step: solver.stepDuration(shape) };
    });
    expect(u.shape.length / ae.shape.length).toBeGreaterThan(1.1);
    expect(u.solver.rise).toBeLessThan(ae.solver.rise);
    expect(relativeError(u.step, ae.step)).toBeLessThan(0.07);
  });

  it('follows the length with the source plane', () => {
    for (const symbol of ['u', 'æ']) {
      const shape = vowelShape(symbol);
      const solver = new Fdtd3d({ model: bare });
      solver.setNose(noseShape(DEFAULT_HEAD).areas);
      solver.setShape(shape.areas, 0, shape.velumIndex, null, shape);
      const peaks = responsePeaks(solver, 1 / solver.stepDuration(shape), 0.08);
      const targets = tubeFormants(shape.areas, shape.length, {
        count: 3,
        walls: false,
      });
      for (const target of targets) {
        const nearest = peaks.reduce((best, peak) =>
          Math.abs(peak - target) < Math.abs(best - target) ? peak : best
        );
        expect(relativeError(nearest, target)).toBeLessThan(0.2);
      }
    }
  });

  it('runs slower for a longer tract so the formants follow its length', () => {
    const solver = new Fdtd3d({ model: bare });
    const rest = bare.lengths[CELL_TRACT];
    expect(solver.stepDuration({})).toBe(solver.stepDuration());
    expect(
      relativeError(
        solver.stepDuration({ length: rest * 1.1 }),
        solver.stepDuration() * 1.1
      )
    ).toBeLessThan(1e-12);
  });
});

describe('3D FDTD rendering', () => {
  const plan = planUtterance('ˈmasa');
  const options = { sampleRate: RATE, solver: 'fdtd3d', model };
  const samples = renderPlan(plan, options);

  it('is stable and about as loud as the waveguide', () => {
    expect(samples.every(Number.isFinite)).toBe(true);
    const wave = renderPlan(plan, { sampleRate: RATE });
    const ratio = rms(samples) / rms(wave);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(2.5);
  });

  it('is deterministic', () => {
    const again = renderPlan(plan, options);
    expect(again.length).toBe(samples.length);
    expect(again.every((value, index) => value === samples[index])).toBe(true);
  });

  it('renders bit-identically with the wasm and JavaScript kernels', () => {
    const solver = new Fdtd3d({ model });
    const reference = new Fdtd3d({ model, kernel: 'js' });
    expect(reference.kernel).toBe(null);
    if (solver.kernel) {
      const js = renderPlan(plan, { ...options, kernel: 'js' });
      expect(js.every((value, index) => value === samples[index])).toBe(true);
    }
  });

  it('skips coefficient updates when the shape does not change', () => {
    const solver = new Fdtd3d({ model });
    const shape = vowelShape('a');
    solver.setShape(shape.areas, 0.2);
    const damping = Float64Array.from(solver.damping);
    solver.damping.fill(0);
    solver.setShape(Float64Array.from(shape.areas), 0.2);
    expect(solver.damping.every((value) => value === 0)).toBe(true);
    solver.setShape(shape.areas, 0.3);
    expect(solver.damping.some((value) => value !== 0)).toBe(true);
    solver.damping.set(damping);
  });

  it('stays stable when the lips open on nearly closed corners (issue 75)', () => {
    // The lip corners of this narrow child mouth stay nearly closed during
    // /t/ while the lips are open: scaling the openings to the lip area gave
    // a cell of fill 1e-4 an opening of 0.45 and the audio turned to NaN.
    const head = randomHeadConfig(9451, { preset: 'child' });
    for (const engine of ['js', 'auto']) {
      const { samples } = synthesize('ta', {
        lang: 'en',
        tier: 'high',
        head,
        engine,
      });
      expect([engine, samples.every(Number.isFinite)]).toEqual([engine, true]);
      expect(rms(samples)).toBeGreaterThan(0.01);
    }
  });

  it('works with a microphone in front of the lips', () => {
    const heard = renderPlan(planUtterance('ˈa'), {
      ...options,
      output: 'microphone',
    });
    expect(heard.every(Number.isFinite)).toBe(true);
    expect(rms(heard)).toBeGreaterThan(0.01);
  });

  describe('nasal murmur', () => {
    let ratios;
    const measured = () => {
      ratios ??= { medium: nasalRatio('medium'), high: nasalRatio('high') };
      return ratios;
    };

    it('keeps the nasal murmur as weak as the waveguide', () => {
      const { medium, high } = measured();
      expect(Math.abs(20 * Math.log10(high / medium))).toBeLessThan(3);
    });

    itUnless(NASAL_TARGET_BLOCKED)(
      'keeps the nasal murmur at a quarter to half of the vowel',
      () => {
        const { high } = measured();
        expect(high).toBeGreaterThan(0.25);
        expect(high).toBeLessThan(0.5);
      }
    );
  });

  it('opens the velar port by the requested area', () => {
    const plan = planUtterance('ˈama');
    const segment = plan.segments.find((item) => item.kind === 'consonant');
    const state = sampleState(plan, (segment.start + segment.end) / 2, {});
    const shape = tractShape(state, DEFAULT_HEAD, {
      sections: 44,
      teeth: true,
    });
    const nose = noseShape(DEFAULT_HEAD).areas;
    for (const dx of [1, 0.6]) {
      const solver = new Fdtd3d({ model: dx === DX ? model : undefined, dx });
      expect(solver.dx).toBe(dx);
      solver.setNose(nose);
      for (const velumArea of [0.3, 0.8, 1.3]) {
        solver.setShape(shape.areas, velumArea, shape.velumIndex, shape.teeth);
        const port = linkArea(solver, LINK_VELUM);
        expect([dx, velumArea, Math.abs(port / velumArea - 1) < 0.15]).toEqual([
          dx,
          velumArea,
          true,
        ]);
      }
      const nostrils = linkArea(solver, LINK_NOSTRILS);
      expect(Math.abs(nostrils / nose.at(-1) - 1)).toBeLessThan(0.15);
    }
  });

  it('moves the source without a click', () => {
    const plan = glidePlan('ˈæ', 'ˈu', 0.3);
    const [from, to] = [0.15, 0.45].map((time) => Math.round(time * RATE));
    const voxels = renderPlan(plan, {
      sampleRate: RATE,
      solver: 'fdtd3d',
      model,
    });
    const wave = renderPlan(plan, { sampleRate: RATE });
    expect(largestStep(voxels, from, to)).toBeLessThan(
      1.5 * largestStep(wave, from, to)
    );
  });

  it('exposes the pressure field and resets it', () => {
    const solver = new Fdtd3d({ model });
    solver.setShape(vowelShape('a').areas, 0);
    for (let n = 0; n < 200; n++) {
      solver.step(n < 20 ? 1 : 0, 0, 0);
    }
    const field = solver.field();
    expect(field.positions.length).toBe(model.cells.length * 3);
    expect(field.pressure.length).toBe(model.cells.length);
    expect(field.kinds.length).toBe(model.cells.length);
    expect(field.pressure.some((value) => value !== 0)).toBe(true);
    solver.reset();
    expect(solver.field().pressure.every((value) => value === 0)).toBe(true);
  });
});
