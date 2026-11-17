/** Voice configuration fitting by statistics and analysis by synthesis. Unlicense. */
import { HEAD_PARAMETERS, presetHeadConfig } from '../head-config.js';
import { synthesize } from '../synthesize.js';
import { resample } from '../audio/resample.js';
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
import { analyzeLegacyVoice } from './voice-features.js';

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
function optionsFor(options) {
  const o = { refine: true, maxRenders: 40, seed: 1, parts: PARTS, ...options };
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
export function nearestPreset(head, preset) {
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
  samples = Array.prototype.slice.call(
    samples,
    0,
    Math.floor((o.maxDuration ?? 30) * sampleRate)
  );
  const input =
    sampleRate === rate
      ? Float32Array.from(samples)
      : resample(samples, sampleRate, rate);
  const mcdMetric = o.transcript ? createMcdMetric(input, rate) : null;
  return (candidate) => {
    const rendered = synthesize(o.transcript || MATCH_TEXT, {
      head: candidate,
      seed: o.seed,
      sampleRate: 16000,
      solver: 'waveguide',
      lang: o.transcript ? (o.language ?? o.lang) : 'en',
      ipa: o.transcript ? o.ipa : false,
      engine: o.engine,
      source: o.source,
    });
    const audio =
      rate < 16000 ? resample(rendered.samples, 16000, rate) : rendered.samples;
    // The objective uses inverse-filter source measures. Legacy HNR/H1-H2
    // diagnostics are needed only for the returned render, or verbose tracing.
    const statistics = accumulate(emptyState(), audio, rate, o, false);
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
        const diagnostics = analyzeLegacyVoice(audio, rate, {
          ...o,
          diagnosticsOnly: true,
        });
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

function roundsFor(o) {
  const round1 = [
    'vocalTractLength',
    'pitch',
    'pitchRange',
    ...(o.source === 'folds' ? [] : ['tenseness']),
    'speechRate',
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
function* fitState(state, samples, sampleRate, options) {
  const o = optionsFor(options),
    stage = statisticsResult(state, o);
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
    for (const [round, allKeys] of roundsFor(o).entries()) {
      const keys = allKeys.filter((k) => o.parts.includes(groups[k]));
      if (!keys.length) {
        continue;
      }
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
  }
  for (const key of Object.keys(parameters)) {
    parameters[key].value = head[key];
  }
  return {
    head,
    parameters,
    preset: nearestPreset(head, o.preset).name,
    features,
    rendered: best?.complete() ?? null,
    distance: best?.distance ?? Infinity,
    renders: context.renders,
    voicedDuration: state.voicedSeconds,
    state: copyState(state),
  };
}
export function* fitVoiceSteps(samples, sampleRate, options = {}) {
  const o = optionsFor(options);
  const state = accumulate(copyState(o.state), samples, sampleRate, o);
  return yield* fitState(state, samples, sampleRate, o);
}
function consume(steps) {
  let next = steps.next();
  while (!next.done) {
    next = steps.next();
  }
  return next.value;
}
export function fitVoice(samples, sampleRate, options = {}) {
  return consume(fitVoiceSteps(samples, sampleRate, options));
}
export function createVoiceFitter(options = {}) {
  const o = optionsFor(options),
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
        fitState(copyState(state), settings.samples, settings.sampleRate, {
          ...o,
          refine: false,
          ...settings,
        })
      );
    },
  };
}
