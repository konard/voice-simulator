/** Incremental fit, recognition and speaker adaptation. Unlicense. */
import { DEFAULT_HEAD, HEAD_PRESETS } from '../head-config.js';
import {
  createRecognizer,
  emptyRecognition,
  validateRate,
  validateSamples,
} from '../recognition/recognizer.js';
import {
  checkRecognitionOptions,
  getRecognitionEngine,
} from '../recognition/engine.js';
import { createEvents } from '../recognition/recognizer-stream.js';
import { synthesize } from '../synthesize.js';
import { loadVoice, saveVoice } from '../voice-file.js';
import { blockPitch, createAudioWindow } from './audio-window.js';
import { createLivePasses } from './live-passes.js';
import { sessionPasses } from './passes.js';
import { cpuTime, createSessionScheduler } from './scheduler.js';
import { createSpeakerTracking } from './tracking.js';

const ANALYSIS_BLOCK = 0.25;

function optionsFor(options) {
  const settings = {
    languages: ['en', 'ru', 'hi', 'zh'],
    preset: 'auto',
    minVoiced: 2,
    window: 20,
    tolerance: 0.02,
    stablePasses: 2,
    maxIterations: 8,
    halfLife: 30,
    driftFactor: 1.5,
    realtime: false,
    backgroundShare: 0.25,
    level: 'auto',
    schedule: (fn) => globalThis.setTimeout(fn, 0),
    ...options,
  };
  validateRate(settings.sampleRate);
  for (const key of [
    'minVoiced',
    'window',
    'tolerance',
    'halfLife',
    'driftFactor',
  ]) {
    if (!Number.isFinite(settings[key]) || settings[key] <= 0) {
      throw new RangeError(`${key} must be positive`);
    }
  }
  for (const key of ['stablePasses', 'maxIterations']) {
    if (!Number.isSafeInteger(settings[key]) || settings[key] < 1) {
      throw new RangeError(`${key} must be a positive integer`);
    }
  }
  if (settings.preset === 'auto') {
    settings.preset = 'any';
  } else if (
    settings.preset !== 'any' &&
    !Object.hasOwn(HEAD_PRESETS, settings.preset)
  ) {
    throw new RangeError('Unknown voice preset');
  }
  if (typeof settings.schedule !== 'function') {
    throw new TypeError('schedule must be a function');
  }
  settings.language =
    settings.languages?.length === 1 ? settings.languages[0] : undefined;
  settings.recognitionEngine = recognitionEngine(settings.engine);
  return settings;
}

/**
 * Voice fits render with `engine` (a name or an Engine from createEngine);
 * the recogniser takes the name of that engine.
 */
function recognitionEngine(engine) {
  const name =
    typeof engine === 'string' || engine === undefined ? engine : engine?.name;
  checkRecognitionOptions({ engine: name });
  return name;
}

function accentOptions(accent) {
  if (typeof accent === 'string') {
    return { accent };
  }
  return accent ? { accent: accent.code, accentLevel: accent.strength } : {};
}

// State, sample cursors and scheduled pass publication share the same lifetime.
// eslint-disable-next-line max-lines-per-function, max-statements
export function createSession(
  options,
  {
    passes = sessionPasses,
    openRecognizer = createRecognizer,
    finalOnly = false,
  } = {}
) {
  const settings = optionsFor(options);
  const { sampleRate, realtime } = settings;
  const window = createAudioWindow(
    Math.max(1, Math.ceil(settings.window * sampleRate))
  );
  const stride = Math.round(sampleRate * ANALYSIS_BLOCK);
  const seed = settings.voice ? loadVoice(settings.voice) : null;
  const events = createEvents();
  const liveWords =
    realtime && sampleRate === 8000 && ['auto', 'low'].includes(settings.level);
  const live =
    liveWords && passes === sessionPasses ? createLivePasses() : null;
  let livePitch = [];
  if (live) {
    settings.kernels = getRecognitionEngine({
      engine: settings.recognitionEngine,
    });
  }
  const recognizer = openRecognizer(
    {
      sampleRate,
      level: liveWords ? 'low' : settings.level,
      languages: settings.languages,
      segments: settings.segments,
      includeModeLabels: settings.includeModeLabels,
      voice: DEFAULT_HEAD,
      deterministic: !realtime,
      engine: settings.recognitionEngine,
      profile: options.profile,
    },
    {
      liveWords,
      finalOnly,
      liveModeReference: settings.includeModeLabels === true,
      onReading:
        live &&
        ((decoded, offset, final) =>
          live.read(decoded, offset, final, settings)),
      onPitch: live && ((row) => livePitch.push(row)),
    }
  );
  const scheduler = createSessionScheduler(settings, receive);
  const tracking = createSpeakerTracking(settings);
  const history = [];
  let state = 'collecting';
  let started = false;
  let ended = false;
  let flushed;
  let backgroundShare;
  let at = 0;
  let bufferOffset = 0;
  let lastAnalyzed = 0;
  let nextAnalysis = stride;
  let voiced = 0;
  let voice;
  let file = null;
  let uncertainty = null;
  let converged = false;
  let waitVoiced = settings.minVoiced;
  let minVoiced = waitVoiced;
  let waitAudio = 0;
  let lastAttempt = -Infinity;
  let stableCount = 0;
  let iterations = 0;
  let refinement;
  let trackAfter = 0;
  let trackedVoiced = 0;
  let awaitingPause = false;
  let captureStart = 0;

  function transition(next, reason) {
    const previous = started ? state : null;
    if (previous !== next) {
      state = next;
      started = true;
      events.emit('state', { state, previous, reason, time: at / sampleRate });
    }
  }

  function initialize() {
    if (!started) {
      transition('collecting', 'start');
    }
  }

  function setShare(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError('backgroundShare must be from 0 to 1');
    }
    backgroundShare = value;
    scheduler.share = value;
    if (value > 0 && !ended && started) {
      advance();
    }
  }

  function publish(next, distance, entry) {
    if (next !== voice || file === null) {
      voice = next;
      file = saveVoice(next);
      if (entry) {
        recognizer.setVoice(next.head, next.articulationOffsets);
      }
    }
    if (entry) {
      history.push({ pass: history.length + 1, state, distance, ...entry });
    }
    events.emit('voice', {
      voice: file,
      uncertainty,
      pass: history.length,
      distance,
      converged,
    });
  }

  function clearSpeaker(initial) {
    scheduler.cancel();
    tracking.clear();
    live?.reset(at);
    livePitch = [];
    bufferOffset = at;
    window.clear();
    lastAnalyzed = 0;
    voiced = 0;
    waitAudio = 0;
    lastAttempt = -Infinity;
    waitVoiced = minVoiced = settings.minVoiced;
    history.length = 0;
    voice = initial;
    file = null;
    uncertainty = null;
    converged = false;
    stableCount = iterations = 0;
    refinement = null;
    trackAfter = 0;
    trackedVoiced = 0;
    awaitingPause = false;
  }

  function changeSpeaker() {
    recognizer.setVoice(DEFAULT_HEAD, undefined, true);
    clearSpeaker(null);
    transition('collecting', 'speaker-change');
  }

  function finishTracking(result, samples, captured, generationVoiced) {
    if (!result) {
      return;
    }
    const action = live
      ? result
      : tracking.observe(result, voice, captured, generationVoiced);
    if (action?.speakerChanged) {
      changeSpeaker();
    } else if (action?.drift) {
      recognizer.discardVoiceChange();
      awaitingPause = false;
      converged = false;
      stableCount = iterations = 0;
      refinement = null;
      transition('refining', 'drift');
    } else if (action?.candidate && !awaitingPause) {
      enqueue('updating', samples, {
        voice,
        ...result,
        candidate: action.candidate,
      });
    }
  }

  function receive({ result, samples, kind, captured, generationVoiced }) {
    if (kind === 'tracking') {
      finishTracking(result, samples, captured, generationVoiced);
    } else if (kind === 'updating') {
      if (result.uncertainty) {
        awaitingPause = true;
        recognizer.setVoice(
          result.voice.head,
          result.voice.articulationOffsets,
          false,
          () => {
            awaitingPause = false;
            uncertainty = result.uncertainty;
            publish(result.voice, result.distance);
          }
        );
      }
    } else if (kind === 'fitting') {
      if (result.failed) {
        minVoiced = Math.min(10, minVoiced + 1);
        waitVoiced = Math.max(minVoiced, generationVoiced);
        waitAudio = captured + sampleRate;
        transition('collecting', 'fit-failed');
      } else {
        publish(result.voice, result.distance, { changes: {}, ipa: '' });
        transition('inverting', 'fitted');
      }
    } else if (kind === 'inverting') {
      publish(result.voice, result.distance, {
        changes: {},
        ipa: result.reading.decoded.ipa,
      });
      if (result.usable) {
        refinement = { samples, reading: result.reading };
        transition('refining', 'phonemes');
      } else {
        waitAudio = captured + sampleRate;
      }
    } else {
      finishRefinement(result, samples, generationVoiced);
    }
    queueDue();
  }

  function finishRefinement(result, samples, generationVoiced) {
    if (live) {
      waitVoiced = generationVoiced + 0.5;
      if (result.wait) {
        return;
      }
    }
    iterations++;
    stableCount = result.unchanged ? stableCount + 1 : 0;
    converged = result.stable;
    uncertainty = result.uncertainty ?? uncertainty;
    publish(result.voice, result.distance, {
      changes: result.changes,
      ipa: result.reading.decoded.ipa,
    });
    refinement = { samples, reading: result.reading };
    if (converged) {
      tracking.start(result.distance, voiced);
      trackedVoiced = voiced;
      trackAfter = window.end + trackingInterval();
      refinement = null;
      transition('stable', 'converged');
    } else if (iterations >= settings.maxIterations) {
      waitVoiced = generationVoiced + 5;
      refinement = null;
      iterations = 0;
    }
  }

  function lastDistance() {
    return history.at(-1)?.distance ?? Infinity;
  }

  function enqueue(kind, samples, context) {
    const captured = at;
    captureStart = captured;
    const generationVoiced = voiced;
    const work = (live?.passes ?? passes)[kind](
      samples,
      { ...context, captured },
      settings
    );
    scheduler.replace(
      (function* () {
        const result = yield* work;
        return { kind, samples, captured, generationVoiced, result };
      })()
    );
  }

  function trackingInterval() {
    return (live ? 5 : 1) * sampleRate;
  }

  function queueTracking() {
    const newSpeech = live ? voiced - trackedVoiced >= 3 : tracking.hasVoiced;
    if (window.end >= trackAfter && newSpeech) {
      trackAfter = window.end + trackingInterval();
      trackedVoiced = voiced;
      enqueue('tracking', window.read(5 * sampleRate), { voice });
    }
  }

  function queueDue() {
    if (!backgroundShare || scheduler.busy || at < waitAudio) {
      return;
    }
    if (state === 'stable') {
      queueTracking();
      return;
    }
    if (voiced + 1e-8 < waitVoiced) {
      return;
    }
    if (state === 'collecting') {
      if (lastAttempt === at) {
        return;
      }
      lastAttempt = at;
      transition(voice ? 'inverting' : 'fitting', 'voiced');
    }
    const samples = (!live && refinement?.samples) || window.read();
    enqueue(state, samples, {
      voice,
      distance: lastDistance(),
      reading: refinement?.reading,
      stableCount,
    });
  }

  function advance() {
    // Drop real-time work whose snapshot is outside the current window.
    if (
      realtime &&
      scheduler.busy &&
      at - captureStart >= settings.window * sampleRate
    ) {
      scheduler.cancel();
      refinement = null;
    }
    queueDue();
    if (!realtime) {
      scheduler.drain();
    }
  }

  function analyze() {
    const pitch = live
      ? livePitch
      : blockPitch(window, sampleRate, lastAnalyzed, window.end, bufferOffset);
    livePitch = [];
    lastAnalyzed = window.end;
    voiced += pitch.length / 100;
    if (state === 'stable') {
      tracking.addPitch(pitch);
      if (tracking.pitchChanged(voice.head.pitch)) {
        changeSpeaker();
      }
    }
    advance();
  }

  function push(chunk) {
    if (ended) {
      throw new RangeError('Reset the session before pushing after flush');
    }
    if (!(chunk instanceof Float32Array)) {
      throw new TypeError('Expected a Float32Array');
    }
    validateSamples(chunk);
    initialize();
    for (let start = 0; start < chunk.length; ) {
      const end = Math.min(chunk.length, start + nextAnalysis - at);
      const part = chunk.subarray(start, end);
      const before = cpuTime();
      recognizer.push(part);
      scheduler.foreground(
        cpuTime() - before,
        (1000 * part.length) / sampleRate
      );
      window.push(part);
      at += part.length;
      start = end;
      if (at === nextAnalysis) {
        nextAnalysis += stride;
        analyze();
      }
    }
  }

  for (const type of ['partial', 'syllable', 'error']) {
    recognizer.on(type, (result) => events.emit(type, result));
  }
  recognizer.on('final', (result) =>
    events.emit('final', { ...result, voice: file })
  );

  clearSpeaker(seed);
  setShare(settings.backgroundShare);
  return {
    get state() {
      return state;
    },
    get voice() {
      return file;
    },
    get uncertainty() {
      return uncertainty;
    },
    get recognizer() {
      return recognizer;
    },
    get converged() {
      return converged;
    },
    get history() {
      return history.slice();
    },
    get load() {
      return scheduler.load;
    },
    get voicedSeconds() {
      return voiced;
    },
    get backgroundShare() {
      return backgroundShare;
    },
    set backgroundShare(value) {
      setShare(value);
    },
    on: events.on,
    off: events.off,
    push,
    flush() {
      if (!ended) {
        initialize();
        if (at > bufferOffset && window.end > lastAnalyzed) {
          analyze();
        }
        scheduler.drain(true);
        scheduler.cancel();
        recognizer.discardVoiceChange();
        const recognition =
          at < sampleRate * 0.05
            ? emptyRecognition(1, settings.segments)
            : recognizer.flush();
        flushed = { ...recognition, voice: file };
        ended = true;
      }
      return globalThis.structuredClone(flushed);
    },
    reset() {
      recognizer.reset();
      scheduler.reset();
      ended = false;
      flushed = undefined;
      at = 0;
      nextAnalysis = stride;
      clearSpeaker(seed);
      started = false;
      transition('collecting', 'reset');
    },
    speak(text, synthesisOptions = {}) {
      if (!file) {
        throw new Error('No voice yet');
      }
      return synthesize(text, {
        ...accentOptions(voice.accent),
        ...synthesisOptions,
        head: voice.head,
        articulationOffsets: voice.articulationOffsets,
      });
    },
  };
}

export function createVoiceSession(options) {
  return createSession(options);
}

/** Copy a voice from one recording using the same deterministic sessions. */
export function copyVoice(samples, sampleRate, options = {}) {
  validateRate(sampleRate);
  const session = createSession(
    {
      ...options,
      sampleRate,
      window: Math.max(1, samples.length) / sampleRate,
      maxIterations: 12,
      segments: true,
      realtime: false,
    },
    // The one-shot caller only consumes the final reading.
    { finalOnly: true }
  );
  session.push(
    samples instanceof Float32Array ? samples : Float32Array.from(samples)
  );
  const recognition = session.flush();
  return {
    voice: session.voice,
    uncertainty: session.uncertainty,
    recognition,
    passes: session.history.length,
    converged: session.converged,
    history: session.history,
  };
}
