/** Pass generators operating on an immutable audio snapshot. Unlicense. */
import { fitVoiceSteps } from '../analysis/voice-fit.js';
import { NoVoicedSpeechError } from '../analysis/voice-fit-statistics.js';
import {
  decodeRecognitionAudio,
  recognitionSettings,
  recognizeDecoded,
} from '../recognition/recognizer.js';
import {
  controlledRefit,
  phoneObservations,
  scoreVoice,
  uncertaintyFor,
  usableReading,
} from './refine.js';
import { parameterChanges } from './numerics.js';

function fitOptions(samples, settings) {
  return {
    language: settings.language,
    engine: 'js',
    preset: settings.preset,
    maxDuration: samples.length / settings.sampleRate,
  };
}

function read(samples, voice, settings) {
  const options = recognitionSettings({
    ...settings,
    voice: voice.head,
    articulationOffsets: voice.articulationOffsets,
  });
  const level = settings.level === 'auto' ? 'medium' : settings.level;
  const { decoded, input, rate } = decodeRecognitionAudio(
    samples,
    settings.sampleRate,
    options,
    level
  );
  return { decoded, input, rate, options, level };
}

function withWords({ decoded, input, rate, options, level }) {
  return {
    decoded,
    words: recognizeDecoded(decoded, input, rate, options, level, false).words,
  };
}

function* statistics(samples, settings) {
  try {
    const { state } = yield* fitVoiceSteps(samples, settings.sampleRate, {
      ...fitOptions(samples, settings),
      refine: false,
    });
    return state;
  } catch (error) {
    if (!(error instanceof NoVoicedSpeechError)) {
      throw error;
    }
    return null;
  }
}

export const sessionPasses = {
  *fitting(samples, context, settings) {
    let fit;
    try {
      // Start from measured statistics and score the initial head with one render.
      fit = yield* fitVoiceSteps(samples, settings.sampleRate, {
        ...fitOptions(samples, settings),
        maxRenders: 1,
      });
    } catch (error) {
      return { failed: true, error };
    }
    return {
      voice: { head: fit.head, preset: fit.preset },
      distance: fit.distance,
    };
  },

  *inverting(samples, { voice, distance }, settings) {
    yield;
    const decoded = read(samples, voice, settings);
    yield;
    if (!Number.isFinite(distance)) {
      const fit = yield* statistics(samples, settings);
      if (fit) {
        yield;
        distance = scoreVoice(voice, fit, samples, settings);
      }
    }
    const usable = Number.isFinite(distance) && usableReading(decoded.decoded);
    const reading = usable
      ? withWords(decoded)
      : { decoded: decoded.decoded, words: [] };
    return { voice, distance, reading, usable };
  },

  *refining(samples, context, settings) {
    const { voice, reading, distance, stableCount } = context;
    let currentReading = reading;
    if (!currentReading) {
      yield;
      currentReading = withWords(read(samples, voice, settings));
    }
    const tokens = yield* phoneObservations(currentReading, voice, settings);
    let candidate = voice;
    let error = distance;
    const fit = tokens.length ? yield* statistics(samples, settings) : null;
    if (fit) {
      yield;
      const objective = (head) => scoreVoice(head, fit, samples, settings);
      const limit = Math.min(distance, objective(voice));
      const proposal = yield* controlledRefit(voice, tokens, objective, limit);
      if (proposal.candidate !== voice) {
        ({ candidate, distance: error } = proposal);
      }
    }
    yield;
    const next = withWords(read(samples, candidate, settings));
    const changes = parameterChanges(voice.head, candidate.head);
    const unchanged =
      fit !== null &&
      usableReading(next.decoded) &&
      Object.values(changes).every((change) => change < settings.tolerance) &&
      next.decoded.ipa === currentReading.decoded.ipa;
    const stable = (unchanged ? stableCount + 1 : 0) >= settings.stablePasses;
    const uncertainty = stable
      ? yield* uncertaintyFor(candidate, tokens)
      : null;
    return {
      voice: candidate,
      distance: error,
      reading: next,
      changes,
      unchanged,
      stable,
      uncertainty,
    };
  },

  *tracking(samples, { voice }, settings) {
    yield;
    const decoded = read(samples, voice, settings);
    yield;
    const tokens = yield* phoneObservations(
      withWords(decoded),
      voice,
      settings
    );
    const fit = yield* statistics(samples, settings);
    if (!fit) {
      return null;
    }
    yield;
    const distance = scoreVoice(voice, fit, samples, settings);
    return { tokens, distance, samples, fit };
  },

  *updating(samples, context, settings) {
    const { voice, candidate: seed, tokens, fit, distance } = context;
    const objective = (head) => scoreVoice(head, fit, samples, settings);
    const { candidate, distance: error } = yield* controlledRefit(
      voice,
      tokens,
      objective,
      distance,
      seed
    );
    const uncertainty =
      candidate === voice ? null : yield* uncertaintyFor(candidate, tokens);
    return { voice: candidate, distance: error, uncertainty };
  },
};
