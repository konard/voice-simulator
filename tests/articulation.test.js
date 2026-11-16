/**
 * Articulatory planning and the vocal tract area model.
 */

import { describe, it, expect } from 'test-anywhere';
import {
  ARTICULATORS,
  CHANNEL_DEFAULTS,
  CONTROL_RATE,
  channelTargets,
  planUtterance,
  smoothChannel,
} from '../src/articulation/plan.js';
import { approachTargets } from '../src/articulation/dynamics.js';
import { sampleState, tractShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { tubeFormants } from '../src/acoustics/transfer.js';
import { piriformBranch } from '../src/acoustics/waveguide.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';
import {
  DEFAULT_HEAD,
  normalizeHeadConfig,
  presetHeadConfig,
} from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { readFileSync } from 'node:fs';

function vowelFormants(symbol, head = DEFAULT_HEAD, branches = () => []) {
  const target = vowelTarget({ phoneme: getPhoneme(symbol) });
  const shape = tractShape({ ...target, rhotic: 0 }, head);
  return tubeFormants(shape.areas, shape.length, {
    count: 3,
    branches: branches(shape),
  });
}

function segmentMiddle(plan, kind, symbol) {
  const segment = plan.segments.find(
    (item) => item.kind === kind && (!symbol || item.token?.base === symbol)
  );
  return (segment.start + segment.end) / 2;
}

describe('planUtterance', () => {
  it('splits a voiceless plosive into closure and release', () => {
    const plan = planUtterance('ˈpa');
    expect(plan.segments.map((segment) => segment.kind)).toEqual([
      'pause',
      'consonant',
      'release',
      'vowel',
      'pause',
    ]);
    expect(plan.frameRate).toBe(CONTROL_RATE);
    expect(plan.channels.f0.length).toBe(plan.frameCount);
  });

  it('starts and ends silent', () => {
    const plan = planUtterance('ˈma');
    expect(plan.channels.loudness[0]).toBeLessThan(0.05);
    expect(plan.channels.loudness.at(-1)).toBeLessThan(0.05);
    const vowel = sampleState(plan, segmentMiddle(plan, 'vowel'));
    expect(vowel.loudness).toBeGreaterThan(0.9);
  });

  it('follows the head pitch and rises for questions', () => {
    const head = normalizeHeadConfig({ pitch: 200, vibrato: 0 });
    const statement = planUtterance('ˈma ˈma .', { head });
    const question = planUtterance('ˈma ˈma ?', { head });
    const middle = sampleState(statement, segmentMiddle(statement, 'vowel'));
    expect(Math.abs(middle.f0 - 200) / 200).toBeLessThan(0.25);
    const lastVowel = (plan) =>
      plan.segments.filter((segment) => segment.kind === 'vowel').at(-1);
    const end = (plan) => sampleState(plan, lastVowel(plan).end - 0.01).f0;
    expect(end(question)).toBeGreaterThan(end(statement) * 1.1);
  });

  it('uses Mandarin tone contours', () => {
    const head = normalizeHeadConfig({ vibrato: 0 });
    const plan = planUtterance('ma˥˩', { head, language: 'zh' });
    const vowel = plan.segments.find((segment) => segment.kind === 'vowel');
    const span = vowel.end - vowel.start;
    const early = sampleState(plan, vowel.start + span * 0.2).f0;
    const late = sampleState(plan, vowel.end - span * 0.1).f0;
    expect(early).toBeGreaterThan(late * 1.15);
  });

  /** f0 at fractions of the vowel of a Mandarin syllable. */
  function vowelPitch(ipa, fractions) {
    const head = normalizeHeadConfig({ vibrato: 0 });
    const plan = planUtterance(ipa, { head, language: 'zh' });
    const vowel = plan.segments.find((segment) => segment.kind === 'vowel');
    const span = vowel.end - vowel.start;
    return fractions.map(
      (fraction) => sampleState(plan, vowel.start + span * fraction).f0
    );
  }

  it('dips in the middle of the Mandarin third tone', () => {
    const [start, middle, end] = vowelPitch('ma˨˩˦', [0.1, 0.45, 0.95]);
    expect(middle).toBeLessThan(start * 0.97);
    expect(end).toBeGreaterThan(middle * 1.15);
  });

  it('keeps the second tone rising all the way', () => {
    const values = vowelPitch('ma˧˥', [0.25, 0.5, 0.75, 0.95]);
    for (let index = 1; index < values.length; index++) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]);
    }
  });

  it('keeps a level first tone', () => {
    const fractions = Array.from({ length: 21 }, (_, index) => index / 20);
    const values = vowelPitch('ma˥', fractions);
    expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.03);
  });

  /** Plan of tonal speech without vibrato. */
  const tonalPlan = (ipa) =>
    planUtterance(ipa, {
      head: normalizeHeadConfig({ vibrato: 0 }),
      language: 'zh',
    });
  const vowelsOf = (plan) =>
    plan.segments.filter((segment) => segment.kind === 'vowel');
  /** f0 at a fraction of the vowel `index` (the second by default). */
  const f0At = (plan, fraction, index = 1) => {
    const vowel = vowelsOf(plan)[index];
    return sampleState(plan, vowel.start + (vowel.end - vowel.start) * fraction)
      .f0;
  };
  const semitonesBetween = (a, b) => 12 * Math.log2(a / b);

  it('starts a tone where the last one ended', () => {
    const afterFall = tonalPlan('ma˥˩ ma˥');
    const afterLevel = tonalPlan('ma˥ ma˥');
    expect(
      semitonesBetween(f0At(afterLevel, 0.1), f0At(afterFall, 0.1))
    ).toBeGreaterThanOrEqual(2);
    expect(
      Math.abs(semitonesBetween(f0At(afterLevel, 0.95), f0At(afterFall, 0.95)))
    ).toBeLessThan(1);
  });

  it('sets the neutral tone by the tone before it', () => {
    const mean = (plan) => {
      const values = Array.from({ length: 11 }, (_, index) =>
        f0At(plan, index / 10)
      );
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    expect(
      semitonesBetween(mean(tonalPlan('ma˥ ma')), mean(tonalPlan('ma˥˩ ma')))
    ).toBeGreaterThanOrEqual(3);
    const afterLow = tonalPlan('ma˨˩ ma');
    expect(
      semitonesBetween(f0At(afterLow, 0.9), f0At(afterLow, 0.1))
    ).toBeGreaterThanOrEqual(1);
  });

  it('shortens the neutral tone', () => {
    const length = (vowel) => vowel.end - vowel.start;
    const [first, neutral] = vowelsOf(tonalPlan('ma˥ ma ma˥'));
    expect(length(neutral)).toBeLessThanOrEqual(0.65 * length(first));
    const [full, last] = vowelsOf(tonalPlan('ma˥ ma'));
    expect(length(last)).toBeLessThan(length(full));
  });

  it('leaves non-tonal speech alone', () => {
    const snapshot = JSON.parse(
      readFileSync(
        new globalThis.URL(
          './fixtures/issue-49/hello-world-f0.json',
          import.meta.url
        ),
        'utf8'
      )
    );
    const plan = planUtterance(snapshot.ipa, {
      head: normalizeHeadConfig(snapshot.head),
      language: snapshot.language,
    });
    expect(plan.channels.f0.length).toBe(snapshot.f0.length);
    // Equal frame by frame (exact in Node); the tolerance of one step of a
    // 32-bit float only allows for the libm of another runtime (Bun).
    plan.channels.f0.forEach((value, frame) =>
      expect(Math.abs(value - snapshot.f0[frame])).toBeLessThanOrEqual(
        value * 2 ** -23
      )
    );
  });

  it('opens the velum for nasals only', () => {
    const plan = planUtterance('ˈama');
    expect(
      sampleState(plan, segmentMiddle(plan, 'consonant')).velum
    ).toBeGreaterThan(0.6);
    expect(sampleState(plan, plan.segments[1].start + 0.03).velum).toBeLessThan(
      0.3
    );
  });
});

/** Time (s) at which `values` first passes `level` (rising or falling). */
function crossing(values, level, frameRate = CONTROL_RATE, from = 0) {
  const above = values[from] >= level;
  for (let index = from + 1; index < values.length; index++) {
    if (values[index] >= level !== above) {
      const fraction =
        (level - values[index - 1]) / (values[index] - values[index - 1]);
      return (index - 1 + fraction) / frameRate;
    }
  }
  return Number.NaN;
}

function steps(values) {
  let time = 0;
  return values.map(([value, duration]) => {
    const target = { value, start: time, end: time + duration, strength: 1 };
    time += duration;
    return target;
  });
}

function consonantOf(plan, symbol) {
  return plan.segments.find(
    (segment) => segment.kind === 'consonant' && segment.token.base === symbol
  );
}

describe('articulator dynamics', () => {
  it('approaches a target without overshoot', () => {
    const values = approachTargets(
      steps([
        [0, 0.1],
        [1, 0.4],
      ]),
      0.02,
      CONTROL_RATE
    );
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(Math.abs(crossing(values, 0.5) - 0.1 - 0.0336)).toBeLessThan(0.005);
    expect(Math.abs(crossing(values, 0.9) - 0.1 - 0.078)).toBeLessThan(0.01);
  });

  it('undershoots a short target', () => {
    const pulse = steps([
      [0, 0.1],
      [1, 0.03],
      [0, 0.3],
    ]);
    expect(
      Math.max(...approachTargets(pulse, 0.02, CONTROL_RATE))
    ).toBeLessThan(0.6);
    expect(
      Math.max(...approachTargets(pulse, 0.006, CONTROL_RATE))
    ).toBeGreaterThan(0.8);
  });

  it('rounds the lips before the vowel', () => {
    const vowelStart = (plan) =>
      plan.segments.find((segment) => segment.kind === 'vowel').start;
    const stu = planUtterance('stu');
    expect(crossing(stu.channels.rounding, 0.5)).toBeLessThan(
      vowelStart(stu) - 0.06
    );
    const tu = planUtterance('tu');
    expect(crossing(tu.channels.rounding, 0.5)).toBeGreaterThanOrEqual(
      consonantOf(tu, 't').start
    );
  });

  it('opens the velum before a nasal', () => {
    const plan = planUtterance('ana');
    const { velum } = plan.channels;
    const lead =
      consonantOf(plan, 'n').start - crossing(velum, Math.max(...velum) / 2);
    expect(lead).toBeGreaterThanOrEqual(0.03);
    expect(lead).toBeLessThanOrEqual(0.12);
  });

  it('lets labials pass and palatals resist', () => {
    const offset = (ipa, symbol) => {
      const plan = planUtterance(ipa);
      const [before, after] = plan.segments.filter(
        (segment) => segment.kind === 'vowel'
      );
      const consonant = consonantOf(plan, symbol);
      const middle = (consonant.start + consonant.end) / 2;
      const fraction = (middle - before.end) / (after.start - before.end);
      const line =
        before.vowel.height +
        (after.vowel.height - before.vowel.height) * fraction;
      return sampleState(plan, middle).height - line;
    };
    expect(Math.abs(offset('ipa', 'p'))).toBeLessThan(0.1);
    expect(offset('iʃa', 'ʃ')).toBeGreaterThanOrEqual(0.2);
  });

  it('keeps the middle of a transition', () => {
    const plan = planUtterance('aba');
    const { frameRate, frameCount, segments } = plan;
    const middle = Math.round(consonantOf(plan, 'b').end * frameRate);
    /** Step function of the targets, smoothed with zero phase. */
    const before = (name, targets) => {
      const values = new Float32Array(frameCount);
      for (const { value, start, end } of targets) {
        values.fill(
          value,
          Math.round(start * frameRate),
          Math.round(end * frameRate)
        );
      }
      return smoothChannel(values, ARTICULATORS[name].timeConstant, frameRate);
    };
    const compare = (name, after, targets) => {
      const old = before(name, targets);
      const low = Math.min(...old.subarray(0, middle));
      const high = Math.max(...old.subarray(0, middle));
      const level = (low + high) / 2;
      const shift = crossing(after, level) - crossing(old, level);
      expect(Math.abs(shift)).toBeLessThan(0.01);
    };
    // lipArea holds the [b] closure through the vowels (their lips are
    // free), so its step has the vowels at the open default here.
    const lipArea = channelTargets(segments, 'lipArea').map((target) => ({
      ...target,
      value: target.strength ? target.value : CHANNEL_DEFAULTS.lipArea,
      strength: 1,
    }));
    const { timeConstant, lead } = ARTICULATORS.lipArea;
    compare(
      'lipArea',
      approachTargets(lipArea, timeConstant, frameRate, undefined, {
        lead,
        frameCount,
      }),
      lipArea
    );
    compare(
      'lipAmount',
      plan.channels.lipAmount,
      channelTargets(segments, 'lipAmount')
    );
  });

  it('takes measured durations', () => {
    const tokens = planUtterance('ˈpata .').tokens;
    const durations = tokens.map((token, index) => 0.05 + 0.02 * index);
    const plan = planUtterance(tokens, { durations });
    tokens.forEach((token, index) => {
      const length = plan.segments
        .filter((segment) => segment.token === token)
        .reduce((sum, segment) => sum + segment.end - segment.start, 0);
      expect(Math.abs(length - durations[index])).toBeLessThan(1e-9);
    });
  });

  it('moves the articulators earlier with more coarticulation', () => {
    const head = (coarticulation) => normalizeHeadConfig({ coarticulation });
    const start = (plan) => crossing(plan.channels.velum, 0.5);
    const early = planUtterance('ˈana', { head: head(2) });
    const late = planUtterance('ˈana', { head: head(0.5) });
    expect(start(early)).toBeLessThan(start(late) - 0.03);
  });
});

describe('smoothChannel', () => {
  it('turns steps into continuous trajectories without lag', () => {
    const values = new Float32Array(200);
    values.fill(1, 100);
    smoothChannel(values, 0.02, CONTROL_RATE);
    let largestStep = 0;
    for (let index = 1; index < values.length; index++) {
      largestStep = Math.max(largestStep, values[index] - values[index - 1]);
    }
    expect(largestStep).toBeLessThan(0.3);
    expect(Math.abs(values[99] + values[100] - 1)).toBeLessThan(0.1);
  });
});

describe('tractShape', () => {
  it('matches the mean vowel formants of men on the male head', () => {
    const head = presetHeadConfig('male');
    const fossae = (shape) => [
      piriformBranch(shape.areas.length, shape.length, head),
    ];
    for (const symbol of [
      'i',
      'ɪ',
      'e',
      'ɛ',
      'æ',
      'ʌ',
      'ɑ',
      'ɔ',
      'o',
      'ʊ',
      'u',
    ]) {
      const formants = vowelFormants(symbol, head, fossae);
      HILLENBRAND.male[symbol].forEach((expected, index) => {
        const error = Math.abs(formants[index] - expected);
        expect(error / expected).toBeLessThan(0.1);
      });
    }
  });

  it('lowers formants for a longer vocal tract', () => {
    const short = vowelFormants(
      'ə',
      normalizeHeadConfig({ vocalTractLength: 13 })
    );
    const long = vowelFormants(
      'ə',
      normalizeHeadConfig({ vocalTractLength: 19 })
    );
    expect(long[0]).toBeLessThan(short[0]);
    expect(long[1]).toBeLessThan(short[1]);
  });

  it('lowers F3 for the rhotic vowel', () => {
    const shape = tractShape(
      { height: 0.5, backness: 0.5, rounding: 0, rhotic: 1 },
      DEFAULT_HEAD
    );
    const formants = tubeFormants(shape.areas, shape.length, { count: 3 });
    expect(formants[2]).toBeLessThan(2200);
  });

  it('closes the lips for /p/ and the alveolar ridge for /t/', () => {
    for (const [ipa, region] of [
      ['ˈapa', [40, 44]],
      ['ˈata', [30, 42]],
    ]) {
      const plan = planUtterance(ipa);
      const state = sampleState(plan, segmentMiddle(plan, 'consonant'));
      const { areas } = tractShape(state, plan.head);
      const narrowest = Math.min(...areas.slice(region[0], region[1]));
      expect(narrowest).toBeLessThan(0.01);
    }
  });

  it('places the fricative source at the constriction', () => {
    const plan = planUtterance('ˈasa');
    const state = sampleState(plan, segmentMiddle(plan, 'consonant'));
    const shape = tractShape(state, plan.head);
    expect(shape.frication.gain).toBeGreaterThan(0.3);
    expect(shape.frication.position).toBeGreaterThan(35);
    expect(shape.frication.sibilance).toBeGreaterThan(0.5);
  });
});
