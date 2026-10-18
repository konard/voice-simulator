/**
 * Listening settings: microphone position, room reverb and the box of air
 * around the head (FDTD enclosure). Uses short vowels and coarse cells so
 * every runtime stays fast.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  ROOM_PRESETS,
  resolveRoom,
  reverberationTime,
  roomImpulseResponse,
} from '../src/acoustics/room.js';
import {
  microphonePosition,
  resolveMicrophone,
} from '../src/acoustics/microphone.js';
import {
  MAX_RADIATION_RADIUS,
  buildVoxelModel,
  enclosureBounds,
  radiationRadius,
  resolveEnclosure,
  voxelModelOptions,
} from '../src/acoustics/voxel-model.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { rms } from '../src/acoustics/analysis.js';
import { planUtterance } from '../src/articulation/plan.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { headLandmarks } from '../src/geometry/centerline.js';

const RATE = 16000;
const SPEED = 34300;
const plan = planUtterance('ɑ', { language: 'ipa' });
const vowelSamples = Math.ceil(plan.duration * RATE);

/**
 * Lag (in samples) of `delayed` relative to `reference` with the highest
 * cross-correlation. A threshold onset depends on the waveform's shape
 * (the output tanh compresses the louder near signal), so it can jump by a
 * pitch period; the correlation peak does not.
 */
function lag(reference, delayed, maxLag) {
  let best = 0;
  let bestValue = -Infinity;
  for (let shift = 0; shift <= maxLag; shift++) {
    let sum = 0;
    for (let index = 0; index + shift < delayed.length; index++) {
      sum += reference[index] * delayed[index + shift];
    }
    if (sum > bestValue) {
      bestValue = sum;
      best = shift;
    }
  }
  return best;
}

/** T20 reverberation time (s) of an impulse response (Schroeder). */
function schroederT20(response, sampleRate) {
  const decay = new Float64Array(response.length);
  let energy = 0;
  for (let index = response.length - 1; index >= 0; index--) {
    energy += response[index] ** 2;
    decay[index] = energy;
  }
  const level = (index) => 10 * Math.log10(decay[index] / decay[0]);
  const start = decay.findIndex((_, index) => level(index) <= -5);
  const end = decay.findIndex((_, index) => level(index) <= -25);
  return ((end - start) / sampleRate) * 3;
}

describe('microphone settings', () => {
  it('validates the position and fills in defaults', () => {
    expect(resolveMicrophone(undefined)).toBe(null);
    expect(resolveMicrophone({})).toEqual({
      distance: 3,
      azimuth: 0,
      elevation: 0,
      compensate: false,
    });
    expect(() => resolveMicrophone({ distance: 0 })).toThrow('distance');
    expect(() => resolveMicrophone({ azimuth: 200 })).toThrow('azimuth');
    expect(() => resolveMicrophone({ elevation: 'up' })).toThrow('elevation');
    const { lips } = headLandmarks(DEFAULT_HEAD);
    const side = microphonePosition({ distance: 10, azimuth: 90 }, lips);
    expect(Math.abs(side[0] - lips[0] - 10) < 1e-9).toBe(true);
    expect(Math.abs(side[2] - lips[2]) < 1e-9).toBe(true);
  });

  it('lowers the level as 1/r and delays the onset (waveguide)', () => {
    const near = renderPlan(plan, { sampleRate: RATE });
    const far = renderPlan(plan, {
      sampleRate: RATE,
      microphone: { distance: 30 },
    });
    const head = near.subarray(0, vowelSamples);
    const ratio = rms(far.subarray(0, vowelSamples)) / rms(head);
    expect(ratio > 0.09 && ratio < 0.11).toBe(true);
    const expected = ((30 - 3) / SPEED) * RATE;
    const delay = lag(near, far, Math.ceil(expected * 3));
    expect(Math.abs(delay - expected) <= 1.5).toBe(true);
    expect(far.length).toBe(near.length + Math.ceil(expected));
  });

  it('keeps the loudness with compensate and is quieter behind the head', () => {
    const near = rms(renderPlan(plan, { sampleRate: RATE }));
    const compensated = rms(
      renderPlan(plan, {
        sampleRate: RATE,
        microphone: { distance: 100, compensate: true },
      })
    );
    expect(Math.abs(compensated / near - 1) < 0.05).toBe(true);
    const front = rms(
      renderPlan(plan, { sampleRate: RATE, microphone: { distance: 30 } })
    );
    const behind = rms(
      renderPlan(plan, {
        sampleRate: RATE,
        microphone: { distance: 30, azimuth: 180 },
      })
    );
    expect(behind < front * 0.8).toBe(true);
  });

  it('follows 1/r in the 3D FDTD free field', () => {
    // The solver's default grid: at 1 cm the lip slit is a cell or two
    // high and the near level depends on where the grid falls.
    const level = (distance) =>
      rms(
        renderPlan(plan, {
          sampleRate: RATE,
          solver: 'fdtd3d',
          dx: 0.8,
          microphone: { distance },
        }).subarray(0, vowelSamples)
      );
    const ratio = level(3) / level(8);
    expect(ratio > 2 && ratio < 3.4).toBe(true);
  });

  it('grows the free-air shell up to the limit', () => {
    expect(radiationRadius(undefined, 1)).toBe(4);
    expect(radiationRadius({ distance: 6 }, 1)).toBe(8);
    expect(radiationRadius({ distance: 300 }, 1)).toBe(MAX_RADIATION_RADIUS);
    expect(voxelModelOptions({})).toEqual({ dx: 0.8 });
    expect(voxelModelOptions({ piriform: true, vallecula: false })).toEqual({
      dx: 0.8,
      vallecula: false,
    });
  });
});

describe('room reverb', () => {
  it('validates rooms and presets', () => {
    expect(resolveRoom(undefined)).toBe(null);
    expect(resolveRoom('anechoic')).toBe(null);
    expect(() => resolveRoom('garage')).toThrow('Unknown room');
    expect(() => resolveRoom({ width: 0, height: 3, depth: 4 })).toThrow(
      'room width'
    );
    const office = resolveRoom('office');
    expect(Math.abs(office.rt60 - ROOM_PRESETS.office.rt60) < 1e-9).toBe(true);
    expect(Math.abs(reverberationTime(office) - office.rt60) < 1e-6).toBe(true);
  });

  it('decays with the requested RT60', () => {
    for (const name of ['studio', 'office', 'bathroom']) {
      const target = ROOM_PRESETS[name].rt60;
      const response = roomImpulseResponse(name, {
        sampleRate: RATE,
        seconds: target * 1.5,
      });
      expect(response.every(Number.isFinite)).toBe(true);
      // The direct sound (sample 0) is not part of the decay.
      const measured = schroederT20(response.subarray(1), RATE);
      expect(Math.abs(measured / target - 1) < 0.2).toBe(true);
    }
  });

  it('adds a tail after the speech', () => {
    const dry = renderPlan(plan, { sampleRate: RATE });
    const wet = renderPlan(plan, { sampleRate: RATE, room: 'small-room' });
    expect(wet.length > dry.length + 0.3 * RATE).toBe(true);
    expect(wet.every(Number.isFinite)).toBe(true);
    expect(rms(wet.subarray(dry.length)) > 0).toBe(true);
  });
});

describe('enclosure', () => {
  const box = { width: 14, height: 12, depth: 12, center: [0, -5.5, 8] };

  it('must contain the lips and stay within the cell budget', () => {
    expect(resolveEnclosure(null)).toBe(null);
    expect(resolveEnclosure({ ...box }).absorption).toBe(0.2);
    expect(() =>
      enclosureBounds(DEFAULT_HEAD, { ...box, center: [0, -5.5, -10] })
    ).toThrow('lips');
    expect(() => resolveEnclosure({ ...box, absorption: 2 })).toThrow(
      'absorption'
    );
    expect(() =>
      buildVoxelModel(DEFAULT_HEAD, {
        dx: 0.3,
        enclosure: { width: 200, height: 200, depth: 200 },
      })
    ).toThrow();
    const model = buildVoxelModel(DEFAULT_HEAD, {
      dx: 1,
      enclosure: resolveEnclosure(box),
    });
    expect(model.enclosure).not.toBe(null);
    expect(model.radiationRadius).toBe(null);
    expect(model.boundaryAdmittance < 1).toBe(true);
  });

  it('is stable and rings longer with harder walls (3D FDTD)', () => {
    const render = (absorption) =>
      renderPlan(plan, {
        sampleRate: RATE,
        solver: 'fdtd3d',
        dx: 1,
        enclosure: { ...box, absorption },
      });
    const soft = render(1);
    const hard = render(0.05);
    expect(soft.every(Number.isFinite)).toBe(true);
    expect(hard.every(Number.isFinite)).toBe(true);
    expect(hard.length > vowelSamples).toBe(true);
    // The tail just after the vowel against the vowel itself: by the end of
    // the closing pause both renders have decayed to rounding noise.
    const vowel = plan.segments.find((segment) => segment.kind === 'vowel');
    const end = Math.round(vowel.end * RATE);
    const late = (samples) =>
      rms(samples.subarray(end + 400, end + 1200)) /
      rms(samples.subarray(Math.round(vowel.start * RATE), end));
    expect(late(hard) > late(soft)).toBe(true);
  });

  it('is approximated by a room on the waveguide', () => {
    const samples = renderPlan(plan, {
      sampleRate: RATE,
      enclosure: { ...box, absorption: 0.2 },
    });
    expect(samples.length > vowelSamples).toBe(true);
    expect(samples.every(Number.isFinite)).toBe(true);
  });
});

describe('default output', () => {
  it('is unchanged without listening settings', () => {
    for (const solver of ['waveguide', 'fdtd3d']) {
      const base = { sampleRate: RATE, solver, dx: 1 };
      const plain = renderPlan(plan, base);
      const explicit = renderPlan(plan, {
        ...base,
        microphone: undefined,
        room: 'anechoic',
        enclosure: null,
      });
      expect(explicit.length).toBe(plain.length);
      expect(explicit.every((value, index) => value === plain[index])).toBe(
        true
      );
    }
  });
});
