/** Pass 2 of recognition: infer a renderable articulation track. Unlicense. */
import { renderPlan } from '../acoustics/voice.js';
import { melCepstralDistortion } from '../metrics/distortion.js';
import { DEFAULT_HEAD, normalizeHeadConfig } from '../head-config.js';
import { buildCodebook, CODEBOOK_CHANNELS } from './codebook.js';
import { createPitchTracker, trackPitch } from './pitch.js';
import { createFormantTracker, trackFormants } from './formants.js';
import {
  CLOSURE_CANDIDATES,
  createTractSearch,
  tractSteps,
} from './inversion-search.js';
import { createTractSmoother } from './inversion-smoother.js';
import { createSourceEstimator, SOURCE_CHANNELS } from './inversion-source.js';
import { refineArticulation } from './inversion-refine.js';

function settingsFor(options, batch) {
  const { candidates = 16, smoothness = 1, lag = 30, refine = false } = options;
  if (!Number.isInteger(candidates) || candidates < 1 || candidates > 64) {
    throw new RangeError('candidates must be an integer from 1 to 64');
  }
  if (!Number.isFinite(smoothness) || smoothness < 0) {
    throw new RangeError('smoothness must be finite and non-negative');
  }
  if (!Number.isInteger(lag) || lag < 0) {
    throw new RangeError('lag must be a non-negative integer');
  }
  if (refine && !batch) {
    throw new RangeError('refinement requires batch inversion');
  }
  return { candidates, smoothness, lag, refine };
}

function outputFor(frames, head, width, capacity) {
  const names = [
    ...CODEBOOK_CHANNELS.map(({ name }) => name),
    ...SOURCE_CHANNELS,
  ];
  const arrays = () =>
    Object.fromEntries(names.map((name) => [name, new Float32Array(capacity)]));
  return {
    frameRate: 1 / frames.hop,
    frameCount: 0,
    duration: 0,
    startTime: frames.startTime,
    committed: 0,
    head,
    channels: arrays(),
    variance: arrays(),
    confidence: new Float32Array(capacity),
    candidates: {
      width,
      count: new Uint8Array(capacity),
      index: new Int32Array(capacity * width).fill(-1),
      cost: new Float32Array(capacity * width).fill(-1),
    },
  };
}

function analysisTracks(frames, options, head, batch) {
  const vocalTractLength = head.vocalTractLength;
  if (batch) {
    const pitch = options.pitch ?? trackPitch(frames);
    const formants =
      options.formants ?? trackFormants(frames, { vocalTractLength, pitch });
    return { pitch, formants, advance() {} };
  }
  const pitchStage = options.pitch ? null : createPitchTracker(frames);
  const pitch = options.pitch ?? pitchStage.track;
  const formantStage = options.formants
    ? null
    : createFormantTracker(frames, { vocalTractLength, pitch });
  return {
    pitch,
    formants: options.formants ?? formantStage.track,
    advance(final) {
      pitchStage?.advance(final);
      formantStage?.advance(final);
    },
  };
}

function createScorer(frames, search, scored, lag) {
  // A gap ending at exactly 150 ms is a cut. Tolerate arithmetic at this boundary.
  const gapLimit = Math.ceil(0.15 / frames.hop - 1e-9);
  let t = 0;
  let next = 0;
  let cut = true;
  return (end, final) => {
    while (t < end) {
      if (frames.speech[t]) {
        search.speech(t++);
        next = t;
        cut = false;
        scored(t);
        continue;
      }
      while (next < end && next - t < gapLimit && !frames.speech[next]) {
        next++;
      }
      if (next === end && !final && !cut && next - t < gapLimit) {
        // This silence could still be an internal closure. For shorter lags,
        // honour the deadline for the previous speech without guessing a row.
        scored(t, next - lag);
        break;
      }
      const closure =
        !cut && next < end && next - t < gapLimit && frames.speech[next];
      search.gap(t, Math.max(t + 1, next), closure, scored);
      t = Math.max(t + 1, next);
      next = t;
      cut = true;
    }
    return t;
  };
}

function createInverter(frames, options, batch) {
  const settings = settingsFor(options, batch);
  const head = options.voice
    ? normalizeHeadConfig(options.voice)
    : DEFAULT_HEAD;
  const capacity = batch ? frames.count : frames.capacity;
  const width = Math.max(settings.candidates, CLOSURE_CANDIDATES);
  const track = outputFor(frames, head, width, capacity);
  const book = options.codebook ?? (capacity ? buildCodebook(head) : null);
  const { pitch, formants, advance } = analysisTracks(
    frames,
    options,
    head,
    batch
  );
  const steps = tractSteps(head, track.frameRate);
  const history = batch ? capacity : Math.min(capacity, settings.lag + 1);
  const path = new Int8Array(capacity).fill(-1);
  const search =
    book &&
    createTractSearch(frames, formants, book, settings, steps, {
      candidates: track.candidates,
      history,
    });
  const smoother = createTractSmoother(track, book, steps, path);
  const source = createSourceEstimator(frames, pitch, track, batch);
  const start = frames.startTime;

  function commit(last, end) {
    const first = track.committed;
    if (last <= first) {
      return;
    }
    search.trace(first, end, path);
    smoother.smooth(first, last, end);
    for (let t = first; t < last; t++) {
      if (path[t] >= 0) {
        track.confidence[t] = Math.exp(
          -track.candidates.cost[t * width + path[t]] / 8
        );
      }
    }
    source(first, last, end);
    track.committed = last;
  }

  const score = createScorer(
    frames,
    search,
    (end, target = end - settings.lag) => {
      if (!batch) {
        commit(Math.min(target, end), end);
      }
    },
    settings.lag
  );

  return {
    frames,
    output: track,
    track,
    advance(final = false) {
      if (start !== frames.startTime || frames.count < track.frameCount) {
        throw new RangeError(
          'Create a new inverter after trimming or resetting the frame set'
        );
      }
      advance(final);
      const end = Math.min(frames.count, pitch.committed, formants.committed);
      if (final && end !== frames.count) {
        throw new RangeError(
          'Final pitch and formant tracks must cover all inversion frames'
        );
      }
      track.frameCount = score(end, final);
      track.duration = final
        ? frames.sampleCount / frames.rate
        : track.frameCount * frames.hop;
      if (final) {
        commit(end, end);
      }
    },
    refine() {
      refineArticulation(frames, track, book, steps, smoother.values);
      smoother.smooth(0, track.frameCount, track.frameCount);
    },
  };
}

export function createArticulationInverter(frames, options = {}) {
  const {
    frames: input,
    track,
    advance,
  } = createInverter(frames, options, false);
  return { frames: input, track, output: track, advance };
}

function renderError(frames, track) {
  const sampleRate = frames.rate;
  const rendered = renderPlan(articulationPlan(track), {
    sampleRate,
    solver: 'waveguide',
    engine: 'js',
    seed: 1,
  });
  const observed = frames.samples.subarray(0, frames.sampleCount);
  return melCepstralDistortion(observed, rendered, sampleRate);
}

export function invertArticulation(frames, options = {}) {
  const inverter = createInverter(frames, options, true);
  inverter.advance(true);
  const { track } = inverter;
  if (options.refine && track.confidence.some((value) => value > 0)) {
    const baselineError = renderError(frames, track);
    const unrefined = Object.fromEntries(
      CODEBOOK_CHANNELS.map(({ name }) => [name, track.channels[name].slice()])
    );
    inverter.refine();
    // The oral objective omits the noisy source and radiation detail of
    // the renderer. Keep the refinement only if the render-back improves.
    if (renderError(frames, track) > baselineError) {
      Object.assign(track.channels, unrefined);
    }
  }
  return track;
}

export function articulationPlan({
  head,
  frameRate,
  frameCount,
  duration,
  channels,
}) {
  return {
    tokens: [],
    segments: [],
    head,
    frameRate,
    frameCount,
    duration,
    channels,
  };
}
