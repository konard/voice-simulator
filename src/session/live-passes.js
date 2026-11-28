/** Acoustic refinement for an 8 kHz live word stream. Unlicense. */
import { fitVoiceSteps } from '../analysis/voice-fit.js';
import { NoVoicedSpeechError } from '../analysis/voice-fit-statistics.js';
import { parameterChanges, retainedWeight } from './numerics.js';
import { usableReading } from './refine.js';

const CORE_PARAMETERS = ['pitch', 'vocalTractLength'];
const MIN_NEW_VOICED = 0.5;

function* measure(samples, settings, state, estimateSource) {
  yield;
  try {
    return yield* fitVoiceSteps(samples, settings.sampleRate, {
      state,
      kernels: settings.kernels,
      language: settings.language,
      preset: settings.preset,
      analysisRate: settings.sampleRate,
      analysisHop: 0.01,
      // Short live observations may cover only part of an intonation contour.
      medianPitch: true,
      estimateSource,
      maxDuration: samples.length / settings.sampleRate,
      refine: false,
      sourceDiagnostics: false,
    });
  } catch (error) {
    if (!(error instanceof NoVoicedSpeechError)) {
      throw error;
    }
    return null;
  }
}

function fittedVoice(fit, voice, settings, voiced) {
  if (!voice) {
    return { head: fit.head, preset: fit.preset };
  }
  const retain = retainedWeight(voiced, settings.halfLife);
  const head = { ...voice.head };
  for (const [name, estimate] of Object.entries(fit.parameters)) {
    if (estimate.frames > 0) {
      head[name] = retain * head[name] + (1 - retain) * estimate.value;
    }
  }
  return { ...voice, head };
}

function uncertainty(fit) {
  return Object.fromEntries(
    Object.entries(fit.parameters).map(([name, estimate]) => [
      name,
      estimate.sd,
    ])
  );
}

function difference(before, after) {
  const changes = parameterChanges(before, after);
  return Math.max(...CORE_PARAMETERS.map((name) => changes[name]));
}

function hasNewEvidence(previous, next) {
  return CORE_PARAMETERS.every(
    (name) => next.parameters[name].frames > previous.parameters[name].frames
  );
}

function absolutePhones(decoded, offset, speakerAt) {
  return decoded.segments
    .filter(({ start }) => start + offset >= speakerAt)
    .map((segment) => ({
      ...segment,
      start: segment.start + offset,
      end: segment.end + offset,
    }));
}

function recentReading(segments, preview, captured, settings) {
  const start = captured / settings.sampleRate - settings.window;
  const recent = [...segments, ...preview].filter(({ end }) => end > start);
  return {
    decoded: { segments: recent, ipa: recent.map(({ ipa }) => ipa).join('') },
  };
}

/** One state per speaker, with each new sample counted at most once. */
export function createLivePasses() {
  let fit;
  let through;
  let segments;
  let preview;
  let speakerStart;
  let stableDistance;
  let driftWindows;

  function* observe(samples, captured, settings) {
    const offset = Math.max(0, through - (captured - samples.length));
    if (offset >= samples.length) {
      return null;
    }
    const next = yield* measure(
      samples.subarray(offset),
      settings,
      fit?.state,
      !fit
    );
    if (
      !next ||
      next.voicedDuration - (fit?.voicedDuration ?? 0) < MIN_NEW_VOICED
    ) {
      return null;
    }
    through = captured;
    fit = next;
    return next;
  }

  return {
    reset(at) {
      fit = null;
      through = at;
      speakerStart = at;
      segments = [];
      preview = [];
      stableDistance = 0;
      driftWindows = 0;
    },
    read(decoded, offset, final, settings) {
      const phones = absolutePhones(
        decoded,
        offset,
        speakerStart / settings.sampleRate
      );
      if (final) {
        segments.push(...phones);
        preview = [];
      } else {
        preview = phones;
      }
      segments = segments.filter(({ end }) => end > offset - settings.window);
    },
    passes: {
      *fitting(samples, { captured }, settings) {
        const next = yield* observe(samples, captured, settings);
        if (!next) {
          return { failed: true };
        }
        return { voice: fittedVoice(next), distance: 0 };
      },
      *inverting(samples, { captured, voice }, settings) {
        const reading = recentReading(segments, preview, captured, settings);
        const usable = usableReading(reading.decoded);
        if (usable) {
          fit ??= yield* observe(samples, captured, settings);
        }
        return { voice, distance: 0, reading, usable: Boolean(fit && usable) };
      },
      *refining(samples, context, settings) {
        const { captured, stableCount, voice } = context;
        const reading =
          context.reading ??
          recentReading(segments, preview, captured, settings);
        if (!usableReading(reading.decoded)) {
          return { wait: true };
        }
        const previous = fit;
        const next = yield* observe(samples, captured, settings);
        if (!next) {
          return { wait: true };
        }
        const candidate = fittedVoice(
          next,
          voice,
          settings,
          next.voicedDuration - previous.voicedDuration
        );
        const distance = difference(previous.head, next.head);
        const unchanged =
          distance < settings.tolerance && hasNewEvidence(previous, next);
        const stable = unchanged && stableCount + 1 >= settings.stablePasses;
        if (stable) {
          stableDistance = distance;
          driftWindows = 0;
        }
        return {
          voice: candidate,
          distance,
          reading,
          changes: parameterChanges(voice.head, candidate.head),
          unchanged,
          stable,
          uncertainty: stable ? uncertainty(next) : null,
        };
      },
      *tracking(samples, { captured, voice }, settings) {
        const recent = yield* measure(samples, settings, undefined, false);
        if (
          !recent ||
          recent.voicedDuration < 3 ||
          !recent.parameters.vocalTractLength.frames
        ) {
          return null;
        }
        const tractChange = Math.abs(
          recent.head.vocalTractLength / voice.head.vocalTractLength - 1
        );
        if (tractChange > 0.08) {
          return { speakerChanged: true };
        }
        const distance = difference(voice.head, recent.head);
        const limit =
          Math.max(stableDistance, settings.tolerance) * settings.driftFactor;
        driftWindows = distance > limit ? driftWindows + 1 : 0;
        if (driftWindows >= 2) {
          fit = recent;
          through = captured;
          return { drift: true };
        }
        return {
          candidate: fittedVoice(
            recent,
            voice,
            settings,
            recent.voicedDuration
          ),
          distance,
          uncertainty: uncertainty(recent),
        };
      },
      *updating(_samples, { candidate, distance, uncertainty }) {
        yield;
        return { voice: candidate, distance, uncertainty };
      },
    },
  };
}
