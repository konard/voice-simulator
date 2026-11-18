/** Reproducible synthetic gates for pass 2 of recognition. Unlicense. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  DEFAULT_HEAD,
  analyzeFrames,
  createFrameAnalyzer,
  buildCodebook,
  presetHeadConfig,
  synthesize,
  planUtterance,
  renderPlan,
  trackPitch,
  trackFormants,
  CODEBOOK_CHANNELS,
  melCepstralDistortion,
  invertArticulation,
  createArticulationInverter,
  articulationPlan,
} from '../src/index.js';
import { VOWELS } from '../src/ipa/inventory.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import { tractSteps } from '../src/recognition/inversion-search.js';
import { createTractSmoother } from '../src/recognition/inversion-smoother.js';
import { LANDMARK_SENTENCES } from '../scripts/landmark-material.mjs';

const books = new Map();
const settings = { solver: 'waveguide', engine: 'js', seed: 1 };
const head = presetHeadConfig('male');
function book(voice) {
  if (!books.has(voice)) {
    books.set(voice, buildCodebook(voice, { size: 5000 }));
  }
  return books.get(voice);
}

const material = new Map();
function sentence(rate) {
  if (!material.has(rate)) {
    const audio = synthesize(LANDMARK_SENTENCES[0][1], {
      ...settings,
      sampleRate: rate,
      head,
    });
    const frames = analyzeFrames(audio.samples, rate);
    const codebook = book(head);
    const pitch = trackPitch(frames);
    const formants = trackFormants(frames, {
      pitch,
      vocalTractLength: head.vocalTractLength,
    });
    const options = { voice: head, codebook, pitch, formants };
    material.set(rate, {
      ...audio,
      frames,
      options,
      track: invertArticulation(frames, options),
    });
  }
  return material.get(rate);
}

function errors({ frames, plan, track }) {
  const ranges = { voicing: 1, f0: 1 };
  for (const { name, min, max } of CODEBOOK_CHANNELS) {
    ranges[name] = max - min;
  }
  const totals = Object.fromEntries(
    Object.keys(ranges).map((name) => [name, 0])
  );
  let count = 0;
  for (let t = 0; t < frames.count; t++) {
    if (!frames.speech[t] || frames.periodicity[t] < 0.45) {
      continue;
    }
    const truth = sampleState(plan, frames.startTime + t * frames.hop);
    for (const name of Object.keys(ranges)) {
      const range = name === 'f0' ? truth.f0 : ranges[name];
      totals[name] += ((track.channels[name][t] - truth[name]) / range) ** 2;
    }
    count++;
  }
  return Object.fromEntries(
    Object.entries(totals).map(([name, sum]) => [name, Math.sqrt(sum / count)])
  );
}

function renderBack(audio, track) {
  const samples = renderPlan(articulationPlan(track), {
    ...settings,
    sampleRate: audio.sampleRate,
  });
  return melCepstralDistortion(audio.samples, samples, audio.sampleRate);
}

it('uses the lowest cumulative cost across candidate rows', () => {
  const frames = analyzeFrames(new Float32Array(80), 8000);
  assert.equal(frames.count, 2);
  frames.speech.fill(1);
  frames.periodicity.fill(1);
  const articulation = new Uint8Array(24);
  articulation[12] = 40;
  let queryCount = 0;
  const codebook = {
    articulation,
    lengthScale: 1,
    referenceLength: 16.5,
    formants: new Float32Array(16),
    stats: { rows: { neutral: 2, vowel: 0, nasalVowel: 0, consonant: 0 } },
    query(_envelope, _k, { index, cost }) {
      index.fill(-1);
      if (queryCount++ === 0) {
        index.set([0, 1]);
        cost.set([160, 176]);
      } else {
        index[0] = 1;
        cost[0] = 0;
      }
    },
  };
  const pitch = { f0: new Float32Array(2), committed: 2 };
  const formants = { valid: new Uint8Array(8), committed: 2 };
  const track = invertArticulation(frames, { codebook, formants, pitch });
  assert.equal(track.confidence[0], Math.fround(Math.exp(-11 / 8)));
});

it('compares formants at the codebook build length', () => {
  const frames = analyzeFrames(new Float32Array(40), 8000);
  frames.speech[0] = 1;
  frames.periodicity[0] = 1;
  const formants = {
    valid: [1, 0, 0],
    frequency: [750],
    variance: [100],
    committed: 1,
  };
  const pitch = { f0: new Float32Array(1), committed: 1 };
  for (const [referenceLength, frequency] of [
    [14, 750],
    [15, 700],
  ]) {
    const codebook = {
      lengthScale: 14 / 16.5,
      referenceLength,
      articulation: new Uint8Array(12),
      formants: [frequency, 0, 0],
      stats: { rows: { neutral: 1, vowel: 0, nasalVowel: 0, consonant: 0 } },
      query(_envelope, _k, { index, cost }) {
        index.fill(-1);
        index[0] = 0;
        cost[0] = 16;
      },
    };
    const track = invertArticulation(frames, { codebook, formants, pitch });
    assert.equal(track.candidates.cost[0], 1);
  }
});

it('recovers steady vowels', () => {
  const vowels = Object.keys(VOWELS);
  assert.equal(vowels.length, 31);
  const scores = [];
  for (const voice of [head, presetHeadConfig('female')]) {
    const sampleRate = 16000;
    const plan = planUtterance(vowels.map((vowel) => `${vowel}ː`).join(''), {
      head: voice,
      durations: vowels.map(() => 0.3),
    });
    const samples = renderPlan(plan, { ...settings, sampleRate });
    const frames = analyzeFrames(samples, sampleRate);
    const track = invertArticulation(frames, { voice, codebook: book(voice) });
    let correct = 0;
    let rounding = 0;
    const vowelSegments = plan.segments.filter(({ kind }) => kind === 'vowel');
    assert.equal(vowelSegments.length, 31);
    for (const segment of vowelSegments) {
      assert.ok(Math.abs(segment.end - segment.start - 0.3) < 1e-6);
      const t = Math.round((segment.start + segment.end) / (2 * frames.hop));
      const truth = sampleState(plan, t * frames.hop);
      const delta = (name) => Math.abs(track.channels[name][t] - truth[name]);
      correct += Number(delta('height') <= 0.15 && delta('backness') <= 0.2);
      rounding += delta('rounding') ** 2;
    }
    scores.push(correct / vowels.length);
    console.log(
      'inversion steady vowels',
      voice.pitch,
      correct,
      vowels.length,
      'rounding RMS',
      Math.sqrt(rounding / vowels.length)
    );
  }
  assert.ok(
    scores.every((score) => score >= 0.85),
    scores.join(', ')
  );
});

it('recovers a sentence', () => {
  const scores = [16000, 8000].map((rate) => {
    const error = errors(sentence(rate));
    console.log('inversion sentence', rate, JSON.stringify(error));
    return error;
  });
  for (const [i, { height, backness, voicing, f0 }] of scores.entries()) {
    assert.ok(height <= [0.12, 0.15][i], `height ${height}`);
    assert.ok(backness <= [0.15, 0.2][i], `backness ${backness}`);
    assert.ok(voicing <= 0.15, `voicing ${voicing}`);
    assert.ok(f0 <= 0.03, `f0 ${f0}`);
  }
});

it('keeps stop-burst ringing out of the 8 kHz pitch track', () => {
  const audio = sentence(8000);
  const { f0 } = audio.options.pitch;
  // The release of "d" in "wind" rings briefly near 600 Hz. The adjacent
  // voiced frames are near 120 Hz, and the release itself is unvoiced.
  assert.ok(f0.subarray(272, 275).every((frequency) => frequency === 0));
  assert.ok(f0[278] > 100 && f0[278] < 150);
  assert.ok(errors(audio).f0 <= 0.03);
});

it('finds the lips in a closure', () => {
  const amounts = [];
  for (const ipa of ['apa', 'ata', 'aka']) {
    const { plan, samples, sampleRate } = synthesize(ipa, {
      ...settings,
      head,
      ipa: true,
      sampleRate: 16000,
    });
    const frames = analyzeFrames(samples, sampleRate);
    const track = invertArticulation(frames, {
      voice: head,
      codebook: book(head),
    });
    const { start, end } = plan.segments.find(
      ({ kind }) => kind === 'consonant'
    );
    const t = Math.round((start + end) / (2 * frames.hop));
    const truth = sampleState(plan, t * frames.hop);
    const { lipAmount, tongueLocation } = track.channels;
    amounts.push(lipAmount[t]);
    console.log(
      'inversion closure',
      ipa,
      'lipAmount',
      lipAmount[t],
      'tongueLocation error',
      Math.abs(tongueLocation[t] - truth.tongueLocation)
    );
  }
  assert.deepEqual(
    amounts.map((x) => x > 0.5),
    [true, false, false]
  );
});

it('moves no faster than the planner', () => {
  const { track } = sentence(16000);
  const steps = tractSteps(track.head, track.frameRate);
  const largest = CODEBOOK_CHANNELS.map(({ name }, c) => {
    const values = track.channels[name];
    return values.reduce(
      (max, value, t) =>
        t ? Math.max(max, Math.abs(value - values[t - 1]) / steps[c]) : max,
      0
    );
  });
  console.log('inversion largest step by channel', largest);
  assert.ok(
    largest.every((step) => step <= 3),
    largest.join(', ')
  );
});

it('renders back close to the input', () => {
  const measurements = [16000, 8000].map((rate) => {
    const audio = sentence(rate);
    const mcd = renderBack(audio, audio.track);
    console.log('inversion render-back MCD', rate, mcd);
    return mcd;
  });
  assert.ok(
    measurements[0] <= 5 && measurements[1] <= 6,
    measurements.join(', ')
  );
});

it('refinement does not hurt', () => {
  const comparisons = [16000, 8000].map((rate) => {
    const audio = sentence(rate);
    const start = globalThis.performance.now();
    const refined = invertArticulation(audio.frames, {
      ...audio.options,
      refine: true,
    });
    const rtf = (globalThis.performance.now() - start) / 1000 / audio.duration;
    const before = renderBack(audio, audio.track);
    const after = renderBack(audio, refined);
    console.log('inversion refinement', rate, before, after, 'rtf', rtf);
    return { before, after, rtf };
  });
  assert.ok(
    comparisons.every(({ before, after, rtf }) => after <= before && rtf <= 1)
  );
});

it('measures variance around the refined tract observation', () => {
  const steps = tractSteps(head, 200);
  const arrays = () =>
    Object.fromEntries(
      CODEBOOK_CHANNELS.map(({ name }) => [name, new Float32Array(1)])
    );
  const track = {
    channels: arrays(),
    variance: arrays(),
    candidates: {
      width: 2,
      count: Uint8Array.of(2),
      index: Int32Array.of(0, 1),
      cost: Float32Array.of(0, 0),
    },
  };
  const articulation = new Uint8Array(2 * steps.length);
  articulation[steps.length] = 255;
  const smoother = createTractSmoother(
    track,
    { articulation },
    steps,
    Int8Array.of(0)
  );
  smoother.smooth(0, 1, 1);
  assert.equal(track.variance.height[0], 0.5);
  smoother.values[0] = 0.5;
  smoother.remeasure(0);
  smoother.smooth(0, 1, 1);
  assert.equal(track.channels.height[0], 0.5);
  assert.equal(track.variance.height[0], 0.25);
});

it('stream agrees with batch', () => {
  const audio = sentence(16000);
  const analyzer = createFrameAnalyzer(audio.sampleRate, {
    maxSeconds: audio.duration + 0.1,
  });
  const inverter = createArticulationInverter(analyzer.frames, {
    voice: head,
    codebook: book(head),
  });
  let previous = [];
  const { track } = inverter;
  for (let i = 0; i < audio.samples.length; i += 320) {
    analyzer.push(audio.samples.subarray(i, i + 320));
    inverter.advance();
    assert.ok(track.committed <= Math.max(0, analyzer.frames.count - 30));
    assert.deepEqual(
      Array.from(track.channels.height.subarray(0, previous.length)),
      previous
    );
    previous = Array.from(track.channels.height.subarray(0, track.committed));
  }
  analyzer.flush();
  inverter.advance(true);
  assert.equal(track.committed, audio.track.frameCount);
  let same = 0;
  let total = 0;
  const ranges = [
    ...CODEBOOK_CHANNELS,
    ...Object.keys(track.channels)
      .filter((name) => !CODEBOOK_CHANNELS.some((c) => c.name === name))
      .map((name) => ({
        name,
        min: 0,
        max: name === 'f0' ? head.pitch : name === 'loudness' ? 1.5 : 1,
      })),
  ];
  for (const { name, min, max } of ranges) {
    for (let t = 0; t < track.frameCount; t++) {
      same += Number(
        Math.abs(track.channels[name][t] - audio.track.channels[name][t]) <
          0.05 * (max - min)
      );
      total++;
    }
  }
  console.log('inversion stream agreement', same / total);
  assert.ok(same / total >= 0.95);
  const ready = createArticulationInverter(audio.frames, audio.options);
  ready.advance();
  assert.equal(ready.track.committed, audio.frames.count - 30);
  ready.advance(true);
  assert.equal(ready.track.committed, audio.frames.count);
});

it('scores only zero-cost closure seeds inside short gaps', () => {
  const frames = analyzeFrames(new Float32Array(400), 8000);
  frames.speech[0] = 1;
  frames.speech[3] = 1;
  const codebook = book(head);
  const { candidates } = invertArticulation(frames, { voice: head, codebook });
  for (const t of [1, 2]) {
    const start = t * candidates.width;
    assert.equal(candidates.count[t], 32);
    for (let j = start; j < start + candidates.count[t]; j++) {
      const i = candidates.index[j] * CODEBOOK_CHANNELS.length;
      const state = codebook.articulation;
      assert.ok(
        (state[i + 5] > 127 && state[i + 6] < 7) ||
          (state[i + 7] > 127 && state[i + 8] < 7)
      );
      assert.equal(candidates.cost[j], 0);
    }
  }
  assert.equal(candidates.count[4], 0);
});

it('waits for scored closure candidates before advancing the fixed lag', () => {
  const frames = analyzeFrames(new Float32Array(160), 8000);
  frames.speech[0] = 1;
  frames.speech[3] = 1;
  const pitch = { f0: new Float32Array(4), committed: 3 };
  const formants = { valid: new Uint8Array(16), committed: 3 };
  const options = {
    voice: head,
    codebook: book(head),
    pitch,
    formants,
    lag: 2,
  };
  const incremental = createArticulationInverter(frames, options);
  incremental.advance();
  assert.equal(incremental.track.frameCount, 1);
  assert.equal(incremental.track.committed, 0);

  pitch.committed = formants.committed = frames.count;
  incremental.advance();
  assert.equal(incremental.track.candidates.count[2], 32);
  assert.equal(incremental.track.committed, 2);
  incremental.advance(true);

  const whole = createArticulationInverter(frames, options);
  whole.advance(true);
  assert.deepEqual(incremental.track.channels, whole.track.channels);
  assert.deepEqual(incremental.track.variance, whole.track.variance);
});

it('cuts long gaps and reports unsupported controls', () => {
  const frames = analyzeFrames(new Float32Array(2000), 8000);
  const track = invertArticulation(frames, { codebook: book(head) });
  assert.equal(track.frameCount, frames.count);
  assert.equal(track.duration, 0.25);
  assert.equal(Object.keys(track.channels).length, 21);
  assert.ok(track.channels.f0.every((f) => f === DEFAULT_HEAD.pitch));
  assert.ok(track.confidence.every((x) => x === 0));
  assert.ok(track.candidates.count.every((n) => n === 0));
  assert.ok(track.candidates.index.every((n) => n === -1));
  assert.ok(track.candidates.cost.every((n) => n === -1));
  for (const name of ['glottalClosure', 'lateral']) {
    assert.ok(track.channels[name].every((x) => x === 0));
    assert.ok(track.variance[name].every((x) => x === Infinity));
  }
});

it('stays within the CPU budget', () => {
  const limit = Number(globalThis.process?.env.INVERSION_RTF_LIMIT ?? 0.4);
  for (const rate of [16000, 8000]) {
    const audio = sentence(rate);
    // Isolate this stage from the separate pitch, formant and table budgets.
    const time = Array.from({ length: 3 }, () => {
      const start = globalThis.performance.now();
      invertArticulation(audio.frames, audio.options);
      return (globalThis.performance.now() - start) / 1000 / audio.duration;
    }).sort((a, b) => a - b)[1];
    console.log('inversion rtf', time, 'at', rate);
    assert.ok(time <= limit, `RTF ${time} exceeds ${limit} at ${rate} Hz`);
  }
});
