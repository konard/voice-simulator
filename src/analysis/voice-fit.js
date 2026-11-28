/** Voice configuration fitting by statistics and analysis by synthesis. Unlicense. */
import {
  HEAD_PARAMETERS,
  HEAD_PRESETS,
  presetHeadConfig,
} from '../head-config.js';
import { synthesizeWithStorage } from '../synthesize.js';
import { resample, resampleWithStorage } from '../audio/resample.js';
import { sampleStorage } from '../audio/sample-storage.js';
import { sliceVoiceSamples } from './voice-features.js';
import {
  featureVector,
  vectorDistance,
  createMcdMetric,
} from './voice-fit-objective.js';
export {
  featureVector,
  vectorDistance,
  alignedMcd,
} from './voice-fit-objective.js';
import {
  accumulate,
  copyState,
  emptyState,
  stateFeatures,
  statisticsResult,
} from './voice-fit-statistics.js';
import { MATCH_TEXT } from './voice-fit-calibration.js';
import { simplex } from './voice-fit-simplex.js';

const PARTS = ['tract', 'pitch', 'source', 'rate'];
const groups = {
  vocalTractLength: 'tract',
  pitch: 'pitch',
  pitchRange: 'pitch',
  tenseness: 'source',
  speechRate: 'rate',
  breathiness: 'source',
  glottalChink: 'source',
  aspirationLevel: 'source',
  nasalCoupling: 'tract',
  pharynxRatio: 'tract',
  oralWidth: 'tract',
  foldLength: 'source',
  foldMass: 'source',
  foldStiffness: 'source',
  foldDamping: 'source',
};
const definition = (key) => HEAD_PARAMETERS.find((p) => p.key === key);
const unit = (key, x) =>
  (x - definition(key).min) / (definition(key).max - definition(key).min);
const physical = (key, x) =>
  definition(key).min + x * (definition(key).max - definition(key).min);
function optionsFor(options, sampleRate) {
  const telephone = sampleRate === 8000 && !options?.transcript;
  const o = {
    refine: true,
    maxRenders: telephone ? 8 : 40,
    seed: 1,
    parts: PARTS,
    ...options,
    telephone,
  };
  if (
    !Number.isInteger(o.maxRenders) ||
    o.maxRenders < 0 ||
    o.maxRenders > 10000
  ) {
    throw new RangeError('maxRenders must be an integer from 0 to 10000');
  }
  if (!Array.isArray(o.parts) || o.parts.some((p) => !PARTS.includes(p))) {
    throw new RangeError('Invalid voice fit parts');
  }
  if (o.onStep !== undefined && typeof o.onStep !== 'function') {
    throw new TypeError('onStep must be a function');
  }
  return o;
}
/**
 * Nearest preset person to a head's pitch and tract length (as matchVoice
 * did). The female and child grids overlap (child at size 1 is 215 Hz and
 * 14.6 cm, female at 0.5 216 Hz and 14.8 cm), so with a `start` head (stage
 * A) its preset is kept unless the tract leaves that preset's range by more
 * than 1 cm, as matchVoice kept the person of its first measurement.
 */
export function nearestPreset(head, preset, start) {
  if (start && !(preset && preset !== 'any')) {
    const name = nearestPreset(start, preset).name;
    const [small, large] = HEAD_PRESETS[name].ranges.vocalTractLength;
    const length = head.vocalTractLength;
    if (length > small - 1 && length < large + 1) {
      return nearestPreset(head, name);
    }
  }
  let best = null;
  for (const name of preset && preset !== 'any'
    ? [preset]
    : ['male', 'female', 'child']) {
    for (let i = 0; i <= 10; i++) {
      const candidate = presetHeadConfig(name, i / 10);
      const cost =
        ((12 * Math.log2(head.pitch / candidate.pitch)) / 3) ** 2 +
        (head.vocalTractLength - candidate.vocalTractLength) ** 2;
      if (!best || cost < best.cost) {
        best = { name, head: candidate, cost };
      }
    }
  }
  return best;
}
function createEvaluator(state, samples, sampleRate, o, theta0, context) {
  if (!samples || !(sampleRate >= 8000)) {
    throw new RangeError('Refinement requires samples and sampleRate');
  }
  const target = featureVector(state);
  const rate = Math.min(16000, sampleRate);
  const analysisOptions = { ...o, retainNucleiCarry: false };
  const renderStorage = sampleStorage();
  const conversionStorage = sampleStorage();
  let mcdMetric = null;
  if (o.transcript) {
    const limit = Math.floor((o.maxDuration ?? 30) * sampleRate);
    const truncated = sliceVoiceSamples(samples, limit);
    const input =
      sampleRate === rate
        ? Float32Array.from(truncated)
        : resample(truncated, sampleRate, rate);
    mcdMetric = createMcdMetric(input, rate);
  }
  return (candidate) => {
    // The next round starts at the preceding round's best vertex. Reuse
    // that exact evaluation; callbacks and renders count actual synthesis.
    if (
      context.best &&
      HEAD_PARAMETERS.every(
        (p) => candidate[p.key] === context.best.head[p.key]
      )
    ) {
      return context.best;
    }
    const rendered = synthesizeWithStorage(
      o.transcript || MATCH_TEXT,
      {
        head: candidate,
        seed: o.seed,
        ...(o.telephone
          ? { tier: 'telephone' }
          : { sampleRate: 16000, solver: 'waveguide' }),
        lang: o.transcript ? (o.language ?? o.lang) : 'en',
        ipa: o.transcript ? o.ipa : false,
        engine: o.engine,
        source: o.source,
        articulationOffsets: o.articulationOffsets,
      },
      renderStorage
    );
    const audio =
      rate === rendered.sampleRate
        ? rendered.samples
        : resampleWithStorage(
            rendered.samples,
            rendered.sampleRate,
            rate,
            conversionStorage
          );
    // The objective uses inverse-filter source measures. Legacy HNR/H1-H2
    // diagnostics are needed only for the returned render, or verbose tracing.
    let completeDiagnostics;
    const statistics = accumulate(
      emptyState(),
      audio,
      rate,
      analysisOptions,
      false,
      (fn) => {
        completeDiagnostics = fn;
      }
    );
    const mcd = mcdMetric?.(audio) ?? null;
    const distance = vectorDistance(
      target,
      featureVector(statistics),
      !!o.transcript,
      mcd
    );
    const penalty =
      0.05 *
      Object.keys(groups)
        .filter((k) => o.parts.includes(groups[k]))
        .reduce(
          (sum, key) =>
            sum +
            ((unit(key, candidate[key]) - unit(key, theta0[key])) / 0.25) ** 2,
          0
        );
    const value = {
      cost: distance + penalty,
      distance,
      head: { ...candidate },
      rendered: stateFeatures(statistics),
    };
    let completed = false;
    value.complete = () => {
      if (!completed) {
        const diagnostics = completeDiagnostics();
        const weight = diagnostics.voicedDuration / 0.01;
        for (const key of ['hnr', 'h1h2']) {
          value.rendered[key] =
            (diagnostics[key] * weight) / Math.max(1, weight);
        }
        completed = true;
      }
      return value.rendered;
    };
    context.renders++;
    const renders = context.renders;
    o.trace?.({
      stage: 'voice-fit-render',
      renders,
      distance,
      cost: value.cost,
      penalty,
      mcd,
      head: { ...candidate },
      features: o.trace ? value.complete() : value.rendered,
    });
    o.onStep?.({ step: renders, renders, distance, head: { ...candidate } });
    return value;
  };
}

/** Score a supplied voice with the same acoustic objective as fitVoice. */
export function measureVoiceFit(state, samples, sampleRate, head, options) {
  const o = optionsFor(options, sampleRate);
  return createEvaluator(state, samples, sampleRate, o, head, {
    renders: 0,
  })(head).distance;
}

function roundsFor(o) {
  const round1 = [
    // At 8 kHz without a transcript, different vowels dominate the sparse
    // upper formants and different intonation shifts f0. Keep the recording's
    // estimates of tract length and baseline pitch while fitting the rest.
    ...(o.telephone ? [] : ['vocalTractLength', 'pitch']),
    'pitchRange',
    ...(o.source === 'folds' ? [] : ['tenseness']),
    // With a transcript stage A reads the rate from the speaking time of the
    // same words within 3 %; the aligned MCD cannot see timing, and its
    // noise from parameters of round two outweighs the rate term about 15
    // times: refining it ends at 1.20 for a true rate of 1.02 and a stage A
    // rate of 1.06 (experiments/issue-63/match-trace-female02.txt).
    ...(o.transcript ? [] : ['speechRate']),
  ];
  const round2 = [
    'breathiness',
    'glottalChink',
    'aspirationLevel',
    ...(o.source === 'folds'
      ? ['foldLength', 'foldMass', 'foldStiffness', 'foldDamping']
      : []),
    ...(o.transcript ? ['nasalCoupling', 'pharynxRatio', 'oralWidth'] : []),
  ];

  return [round1, round2];
}

function updateUncertainty(parameters, keys, vertices, head) {
  if (vertices.length) {
    for (const key of keys) {
      const mean =
        vertices.reduce((sum, v) => sum + v.head[key], 0) / vertices.length;
      const sd = Math.sqrt(
        vertices.reduce((sum, v) => sum + (v.head[key] - mean) ** 2, 0) /
          vertices.length
      );
      parameters[key] = {
        value: head[key],
        sd: Math.max(parameters[key].sd, sd, Number.EPSILON),
        source: 'refined',
        frames: parameters[key].frames,
      };
    }
  }
}
// The dF tract of a sentence depends on its vowels: the north wind text
// reads 7 % long for 14 to 18 cm where MATCH_TEXT reads 1 % short
// (experiments/issue-63/tract-pitch-grid.txt), and near theta0 that error
// alone raises the aligned MCD from 6 to 17 dB, hiding every other parameter
// (mcd-noise.txt). With a transcript the render of theta0 says the same
// words, so the ratio of the recording's to the render's reading removes the
// bias of the words, as the speaking time and the planned f0 do in stage A.
// The render counts in round one's budget.
function correctTract(evaluate, head, stage, o, budgets) {
  const { features, parameters, theta0 } = stage;
  if (!o.transcript || !o.parts.includes('tract') || budgets[0] < 2) {
    return head;
  }
  budgets[0]--;
  const read = evaluate(head).rendered.vocalTractLength;
  if (!(read > 0) || !(features.vocalTractLength > 0)) {
    return head;
  }
  const p = definition('vocalTractLength');
  const length = Math.max(
    p.min,
    Math.min(p.max, (head.vocalTractLength * features.vocalTractLength) / read)
  );
  parameters.vocalTractLength.value = length;
  theta0.vocalTractLength = length;
  return { ...head, vocalTractLength: length };
}
function* fitState(state, samples, sampleRate, o) {
  const stage = statisticsResult(state, o);
  const { parameters, features } = stage;
  let head = stage.head,
    best = null,
    step = 0;
  const context = { renders: 0 };
  yield { step: step++, renders: 0, distance: Infinity, head: { ...head } };
  const theta0 = { ...head };
  if (o.refine && o.maxRenders > 0) {
    const evaluate = createEvaluator(
      state,
      samples,
      sampleRate,
      o,
      theta0,
      context
    );
    const budgets = [
      Math.floor(o.maxRenders * 0.6),
      o.maxRenders - Math.floor(o.maxRenders * 0.6),
    ];
    head = correctTract(
      evaluate,
      head,
      { features, parameters, theta0 },
      o,
      budgets
    );
    for (const [round, allKeys] of roundsFor(o).entries()) {
      const keys = allKeys.filter((k) => o.parts.includes(groups[k]));
      const base = { ...head };
      const evaluateUnit = (x) =>
        evaluate({
          ...base,
          ...Object.fromEntries(keys.map((k, i) => [k, physical(k, x[i])])),
        });
      const search = simplex(
        keys.map((k) => unit(k, head[k])),
        evaluateUnit,
        budgets[round]
      );
      let next = search.next();
      while (!next.done) {
        const value = next.value;
        if (!best || value.cost < best.cost) {
          best = value;
          context.best = value;
          head = { ...value.head };
          yield {
            step: step++,
            renders: context.renders,
            distance: value.distance,
            head: { ...head },
          };
        }
        next = search.next();
      }
      updateUncertainty(parameters, keys, next.value, head);
    }
    if (o.telephone && !best && o.parts.includes('tract')) {
      // A tract-only request still scores the direct estimate once.
      best = evaluate(head);
      yield {
        step,
        renders: context.renders,
        distance: best.distance,
        head: { ...head },
      };
    }
  }
  for (const key of Object.keys(parameters)) {
    parameters[key].value = head[key];
  }
  return {
    head,
    parameters,
    preset: nearestPreset(head, o.preset, stage.head).name,
    features,
    rendered: best?.complete() ?? null,
    distance: best?.distance ?? Infinity,
    renders: context.renders,
    voicedDuration: state.voicedSeconds,
    // Both callers pass a private snapshot. Transfer it to the result.
    state,
  };
}
export function* fitVoiceSteps(samples, sampleRate, options = {}, frontEnd) {
  const o = optionsFor(options, sampleRate);
  const state = accumulate(
    copyState(o.state),
    samples,
    sampleRate,
    { ...o, frontEnd },
    o.sourceDiagnostics !== false
  );
  return yield* fitState(state, samples, sampleRate, o);
}
function consume(steps) {
  let next = steps.next();
  while (!next.done) {
    next = steps.next();
  }
  return next.value;
}
export function fitVoice(samples, sampleRate, options = {}, frontEnd) {
  return consume(fitVoiceSteps(samples, sampleRate, options, frontEnd));
}
export function createVoiceFitter(options = {}) {
  const initial = { ...options };
  const o = optionsFor(initial),
    state = copyState(o.state);
  return {
    get state() {
      return copyState(state);
    },
    update(samples, sampleRate) {
      accumulate(state, samples, sampleRate, o);
      return this;
    },
    result(settings = {}) {
      return consume(
        fitState(
          copyState(state),
          settings.samples,
          settings.sampleRate,
          optionsFor(
            { ...initial, refine: false, ...settings },
            settings.sampleRate ?? state.landmarks.sampleRate
          )
        )
      );
    },
  };
}
