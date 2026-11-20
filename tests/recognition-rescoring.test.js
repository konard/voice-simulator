/** Analysis-by-synthesis and the published IPA result contract. Unlicense. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  analyzeFrames,
  audioToIpa,
  errorRate,
  parseIpa,
  planReading,
  planRescoring,
  planUtterance,
  renderPlan,
  rescoreHypotheses,
  scoreJob,
  warpPlan,
} from '../src/index.js';
import {
  DECODE_SENTENCES,
  DECODER_VOICES,
  mean,
  plannedPhones,
  renderDecoderText,
} from './helpers/decoder-material.js';

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected}`
  );
const options = { language: 'en', voice: DECODER_VOICES.male };
const byRate = new Map();

function sentenceCases(rate) {
  if (!byRate.has(rate)) {
    byRate.set(
      rate,
      Object.entries(DECODE_SENTENCES).map(([language, [text]], index) => {
        const voice = index % 2 ? DECODER_VOICES.female : DECODER_VOICES.male;
        const { plan, samples } = renderDecoderText(
          text,
          voice,
          rate,
          language
        );
        return {
          reference: plannedPhones(plan).map(({ ipa }) => ipa),
          decoded: audioToIpa(samples, rate, { voice, language, nbest: 10 }),
        };
      })
    );
  }
  return byRate.get(rate);
}

it('warpPlan keeps a plan', () => {
  const plan = planUtterance('bala');
  const warped = warpPlan(plan, [
    [0, 0],
    [plan.duration, plan.duration],
  ]);
  assert.equal(warped.head, plan.head);
  assert.equal(warped.tokens, plan.tokens);
  assert.equal(warped.offset, 0);
  assert.equal(warped.frameCount, plan.frameCount);
  for (const [key, values] of Object.entries(plan.channels)) {
    values.forEach((value, index) => close(warped.channels[key][index], value));
  }
});

it('warpPlan stretches time and records the time of sample zero', () => {
  const plan = planUtterance('bala');
  const offset = 0.51;
  const warped = warpPlan(plan, [
    [0, offset],
    [plan.duration, offset + 2 * plan.duration],
  ]);
  close(warped.duration, 2 * plan.duration);
  close(warped.offset, offset);
  assert.equal(
    warped.frameCount,
    Math.ceil(warped.duration * plan.frameRate) + 1
  );
  for (let i = 0; i < 20; i++) {
    const frame = Math.floor((i * (plan.frameCount - 1)) / 20);
    close(warped.channels.height[2 * frame], plan.channels.height[frame], 0.02);
  }
  const shifted = warpPlan(plan, [
    [0.1, 0.2],
    [0.3, 0.6],
  ]);
  close(shifted.offset, 0.1);
  close(shifted.duration, plan.duration + 0.2);
  assert.throws(
    () =>
      warpPlan(plan, [
        [0, 1],
        [0.2, 1],
      ]),
    RangeError
  );
});

it('planReading follows the times and copies source controls', () => {
  const { decoded } = sentenceCases(8000)[0];
  const plan = planReading(decoded, decoded.segments);
  const original = plannedPhones(plan);
  const segments = decoded.segments.filter(({ kind }) => kind !== 'pause');
  assert.equal(original.length, segments.length);
  for (const [i, phone] of original.entries()) {
    close(phone.start + plan.offset, segments[i].start, 0.005);
  }
  close(original.at(-1).end + plan.offset, segments.at(-1).end, 0.005);
  assert.ok(plan.channels.f0.every(Number.isFinite));
  assert.ok(plan.channels.loudness.every(Number.isFinite));
  const neutral = planReading({ ...decoded, tracks: {} }, segments);
  assert.deepEqual(plan.channels.voicing, neutral.channels.voicing);
  assert.notDeepEqual(plan.channels.f0, neutral.channels.f0);
  assert.notDeepEqual(plan.channels.loudness, neutral.channels.loudness);
});

function timedReading(ipa, times, cost = 0) {
  return {
    ipa,
    cost,
    confidence: 0,
    segments: parseIpa(ipa).tokens.map((token, index) => ({
      ipa: token.symbol,
      kind: token.kind,
      start: times[index][0],
      end: times[index][1],
      confidence: 0,
      long: false,
      cost: cost / times.length,
    })),
  };
}

function handMade(ipa, readings, rate = 16000) {
  const plan = planUtterance(ipa, {
    head: options.voice,
    language: options.language,
  });
  const samples = renderPlan(plan, {
    solver: 'waveguide',
    engine: 'js',
    sampleRate: rate,
    seed: 1,
  });
  const times = plannedPhones(plan).map(({ start, end }) => [start, end]);
  const nbest = readings.map((word) => timedReading(word, times));
  return {
    ...nbest[0],
    nbest,
    voice: options.voice,
    language: options.language,
    syllables: [
      {
        ipa: nbest[0].ipa,
        start: times[0][0],
        end: times.at(-1)[1],
        segments: [0, times.length],
      },
    ],
    tracks: { articulation: { ...plan, startTime: 0 } },
    frames: analyzeFrames(samples, rate),
  };
}

it('the true reading sounds closest', () => {
  const consonants = [
    'b',
    'd',
    'g',
    'm',
    'n',
    's',
    'ʃ',
    'f',
    'p',
    't',
    'k',
    'l',
  ];
  const vowels = ['i', 'e', 'u', 'o'];
  let correct = 0;
  for (const letters of [consonants, vowels]) {
    for (const [index, letter] of letters.entries()) {
      const word = (phone) =>
        letters === consonants ? `${phone}a` : `b${phone}`;
      const alternatives = [1, 3, 5].map(
        (step) => letters[(index + step) % letters.length]
      );
      if (letters === vowels) {
        alternatives.splice(2, 1, 'a');
      }
      // Alternate between a correct decoder reference and a competing
      // reference to exercise both reuse and a genuine acoustic promotion.
      alternatives.splice(index % 2, 0, letter);
      const decoded = handMade(word(letter), alternatives.map(word));
      const result = rescoreHypotheses(decoded);
      correct += Number(result.ipa === word(letter));
    }
  }
  console.log('rescoring true reading first', correct, '/ 16');
  assert.ok(correct >= 13);
});

for (const rate of [16000, 8000]) {
  it(`does not hurt synthetic speech at ${rate} Hz`, () => {
    const rows = sentenceCases(rate).map(({ reference, decoded }) => {
      const error = (ipa) => errorRate(reference, ipa, 'phone').rate;
      const before = error(decoded.ipa);
      const after = error(rescoreHypotheses(decoded).ipa);
      return {
        before,
        after,
        oracle: Math.min(before, ...decoded.nbest.map(({ ipa }) => error(ipa))),
      };
    });
    const [before, after, oracle] = ['before', 'after', 'oracle'].map((key) =>
      mean(rows.map((row) => row[key]))
    );
    console.log(
      'rescoring synthetic PER',
      rate,
      'before',
      before,
      'after',
      after,
      'oracle',
      oracle
    );
    assert.ok(after <= before);
  });
}

it('leaves a single reading and agreeing readings alone', () => {
  const decoded = handMade('ba', ['ba']);
  for (const nbest of [decoded.nbest, [...decoded.nbest, ...decoded.nbest]]) {
    const input = { ...decoded, nbest };
    const result = rescoreHypotheses(input);
    assert.equal(result.ipa, input.ipa);
    assert.equal(result.nbest, input.nbest);
    assert.equal(result.rescoring.renders, 0);
  }
});

it('respects the render budget and yields cloneable, repeatable jobs', () => {
  const decoded = handMade('balaba', ['delada', 'balaba', 'galaga']);
  const budget = { maxRenderSeconds: 0.5, weight: 0.5 };
  const preparation = planRescoring(decoded, budget);
  assert.ok(preparation.scheduled.length < preparation.regions);
  const rendered = (plan) =>
    Math.ceil(plan.duration * decoded.frames.rate) / decoded.frames.rate;
  const referenceSeconds = rendered(
    planReading(decoded, decoded.nbest[0].segments)
  );
  const lastRegion = preparation.scheduled.at(-1);
  const lastJobs = preparation.jobs.slice(-lastRegion.alternatives.length);
  const overshoot = lastJobs.reduce(
    (sum, { plan }) => sum + (plan ? rendered(plan) : 0),
    0
  );
  assert.ok(preparation.renderSeconds > referenceSeconds + 0.5);
  assert.ok(
    preparation.renderSeconds <= referenceSeconds + 0.5 + overshoot + 1e-9
  );
  const independent = globalThis.structuredClone(preparation.jobs);
  assert.deepEqual(independent.map(scoreJob), preparation.jobs.map(scoreJob));
  const run = () => {
    const result = rescoreHypotheses(decoded, budget);
    delete result.rescoring.seconds;
    return result;
  };
  assert.deepEqual(run(), run());
});

it('allows a phrase to revise published IPA while preserving published times', () => {
  const decoded = handMade('ba', ['da', 'ba']);
  const split = timedReading('bla', [
    [0.06, 0.09],
    [0.09, decoded.segments[0].end],
    [decoded.segments[1].start, decoded.segments[1].end],
  ]);
  decoded.nbest.push(split);
  const result = rescoreHypotheses(decoded, {
    weight: 0.5,
    preserveTiming: true,
  });
  assert.equal(result.ipa, 'ba');
  assert.equal(result.segments[0].revised, true);
  assert.equal(result.syllables[0].revised, true);
  for (const key of ['segments', 'syllables']) {
    assert.deepEqual(
      result[key].map(({ start, end }) => [start, end]),
      decoded[key].map(({ start, end }) => [start, end])
    );
  }
});

it('stays within the CPU budget', () => {
  for (const rate of [16000, 8000]) {
    const cases = sentenceCases(rate);
    let duration = 0;
    let seconds = 0;
    let renders = 0;
    for (const { decoded } of cases) {
      const { rescoring } = rescoreHypotheses(decoded);
      renders += rescoring.renders;
      seconds += rescoring.seconds;
      duration += decoded.frames.sampleCount / rate;
    }
    assert.ok(renders > 0);
    const rtf = seconds / duration;
    console.log('rescoring rtf', rtf.toFixed(6), 'at', rate, 'Hz');
    assert.ok(rtf <= Number(process.env.RESCORING_RTF_LIMIT ?? 2));
  }
});
