/** Public audio recognition and shared batch/stream composition. Unlicense. */
import { resample } from '../audio/resample.js';
import { LANGUAGES } from '../g2p/index.js';
import { decoderWhisperSpans } from './decode-pipeline.js';
import { audioToIpa } from './decode.js';
import { ipaToText } from './ipa-to-text.js';
import { identifyLanguage, languageShares } from './language-id.js';
import { recognizeModes } from './modes.js';
import { markProsody, measureProsody } from './prosody.js';
import { rescoreHypotheses } from './rescoring.js';

export { createRecognizer } from './recognizer-stream.js';

export const RECOGNITION_LEVELS = Object.freeze({
  low: Object.freeze({ rate: 8000, hop: 0.01, beam: 8 }),
  medium: Object.freeze({ rate: 16000, hop: 0.005, beam: 32 }),
  high: Object.freeze({ rate: 16000, hop: 0.005, beam: 128 }),
});

export function levelForTier(name) {
  if (name === 'telephone' || name === 'narrowband') {
    return 'low';
  }
  return ['wideband', 'minimal', 'low'].includes(name) ? 'medium' : 'high';
}

export class RecognitionError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'RecognitionError';
    this.code = code;
  }
}

function checkOptions(languages, nbest, level) {
  if (
    !Array.isArray(languages) ||
    !languages.length ||
    new Set(languages).size !== languages.length ||
    languages.some((language) => !Object.hasOwn(LANGUAGES, language))
  ) {
    throw new RangeError('languages must contain distinct supported codes');
  }
  if (!Number.isInteger(nbest) || nbest < 1 || nbest > 10) {
    throw new RangeError('nbest must be an integer from 1 to 10');
  }
  if (level !== 'auto' && !Object.hasOwn(RECOGNITION_LEVELS, level)) {
    throw new RangeError('level must be auto, low, medium or high');
  }
}

export function recognitionSettings(options) {
  const {
    languages = Object.keys(LANGUAGES),
    voice = null,
    nbest = 1,
    rescoring = false,
    modes = true,
    whisper = 'auto',
    level = 'auto',
    stages = {},
    deterministic = false,
    articulationOffsets,
  } = options;
  checkOptions(languages, nbest, level);
  if (rescoring && typeof rescoreHypotheses !== 'function') {
    throw new RecognitionError(
      'rescoring-unavailable',
      'IPA rescoring is unavailable'
    );
  }
  return {
    languages: [...languages],
    voice,
    nbest,
    rescoring,
    modes,
    whisper: decoderWhisperSpans(whisper),
    level,
    stages,
    deterministic,
    articulationOffsets,
  };
}

export function validateRate(sampleRate) {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 192000
  ) {
    throw new RangeError('sampleRate must be from 8000 to 192000 Hz');
  }
}

export function validateSamples(samples) {
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) {
      throw new RangeError('Audio samples must be finite');
    }
  }
}

export function decoderOptions(settings, level, start = 0) {
  const { languages, voice, nbest, rescoring, whisper } = settings;
  return {
    ...RECOGNITION_LEVELS[level],
    languages,
    language: languages.length === 1 ? languages[0] : undefined,
    voice,
    articulationOffsets: settings.articulationOffsets,
    nbest: rescoring ? 10 : nbest,
    whisper:
      start && Array.isArray(whisper)
        ? whisper
            .filter(({ end }) => end > start)
            .map((span) => ({
              ...span,
              start: Math.max(0, span.start - start),
              end: span.end - start,
            }))
        : whisper,
  };
}

export function decodeRecognitionAudio(
  samples,
  sampleRate,
  settings,
  level,
  start
) {
  const options = decoderOptions(settings, level, start);
  const rate = Math.min(sampleRate, options.rate);
  const input =
    rate < sampleRate ? resample(samples, sampleRate, rate) : samples;
  const decoded = settings.stages.audioToIpa
    ? settings.stages.audioToIpa(input, rate, options)
    : audioToIpa(input, rate, { ...options, sourceRate: sampleRate });
  return { decoded, input, rate };
}

export function emptyRecognition(nbest) {
  const result = {
    ipa: '',
    text: '',
    languages: [],
    words: [],
    modes: [],
    voice: null,
  };
  return nbest > 1 ? { ...result, alternatives: [] } : result;
}

function timedPhones(decoded) {
  return decoded.segments?.length
    ? decoded.segments.flatMap((segment) => {
        if (segment.kind !== 'pause') {
          return [segment];
        }
        return segment.end - segment.start >= 0.3
          ? [{ ...segment, ipa: '|' }]
          : [];
      })
    : decoded.ipa;
}

function decodeText(input, settings, level, modelLanguage) {
  const { languages, stages, nbest } = settings;
  const language = languages.length === 1 ? languages[0] : undefined;
  // A verified synthesis model provides its own language. Injected stages
  // continue to receive the languages explicitly requested by the caller.
  const candidates =
    modelLanguage && !stages.identifyLanguage ? [modelLanguage] : languages;
  const identification = language
    ? null
    : (stages.identifyLanguage ?? identifyLanguage)(input, {
        languages: candidates,
      });
  return (stages.ipaToText ?? ipaToText)(input, {
    language,
    spans: identification?.spans,
    boundaries:
      modelLanguage && Array.isArray(input) && input[0]?.modelWord !== undefined
        ? 'given'
        : undefined,
    nbest,
    beam: RECOGNITION_LEVELS[level].beam,
  });
}

function recognizeProsody(decoded, samples, rate, settings, level) {
  const input = timedPhones(decoded);
  const pitch = decoded.tracks?.pitch;
  if (!settings.modes || !pitch || !Array.isArray(input)) {
    return decodeText(input, settings, level, decoded.modelLanguage);
  }
  const options = {
    language:
      settings.languages.length === 1 ? settings.languages[0] : undefined,
    voice: settings.voice ?? decoded.voice,
    pitch,
    frames: decoded.frames?.speech ? decoded.frames : undefined,
    whisperSpans: settings.whisper === false ? [] : decoded.whisperSpans,
  };
  const measured = measureProsody(samples, rate, input, options);
  const primary = decodeText(
    measured.sounds,
    settings,
    level,
    decoded.modelLanguage
  );
  return markProsody(primary, measured, options);
}

function publicWord({
  text,
  ipa,
  language,
  start,
  end,
  confidence,
  syllables,
}) {
  return {
    text,
    ipa,
    language,
    start,
    end,
    confidence,
    syllables: syllables.map(({ text, ipa, start, end, stress }) => ({
      text,
      ipa,
      start,
      end,
      stress,
    })),
  };
}

function alternativesFor(decoded, primary, settings, level) {
  const candidates = [...(primary.alternatives ?? [])];
  if (candidates.length < settings.nbest - 1) {
    for (const reading of (decoded.nbest ?? []).slice(1)) {
      const { text, ipa } = decodeText(
        timedPhones(reading),
        { ...settings, nbest: 1 },
        level
      );
      candidates.push({ text, ipa, confidence: reading.confidence });
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const seen = new Set([primary.text]);
  return candidates
    .filter(({ text }) => {
      if (seen.has(text)) {
        return false;
      }
      seen.add(text);
      return true;
    })
    .slice(0, settings.nbest - 1);
}

export function recognizeDecoded(
  decoded,
  samples,
  rate,
  settings,
  level,
  final
) {
  if (!decoded.ipa) {
    return emptyRecognition(settings.nbest);
  }
  if (settings.rescoring && final) {
    decoded = rescoreHypotheses(decoded, {
      preserveTiming: final === 'stream',
    });
  }
  const primary = recognizeProsody(decoded, samples, rate, settings, level);
  const withModes =
    settings.modes && typeof recognizeModes === 'function'
      ? recognizeModes(
          samples,
          rate,
          {
            ...primary,
            whisperSpans:
              settings.whisper === false ? [] : decoded.whisperSpans,
          },
          {
            voice: settings.voice ? { head: settings.voice } : undefined,
            maxSeconds: samples.length / rate,
            frames: decoded.frames?.speech ? decoded.frames : undefined,
          }
        )
      : primary;
  const { ipa, text, modes = [] } = withModes;
  const words = withModes.words.map(publicWord);
  const result = {
    ipa,
    text,
    languages: languageShares(words),
    words,
    modes,
    voice: null,
  };
  if (settings.nbest > 1) {
    result.alternatives = alternativesFor(decoded, primary, settings, level);
  }
  return result;
}

/** Uniform audible energy lacks the 5 dB of contrast required by recognition. */
export function noisyFrames(energy, count, seconds) {
  if (!energy || count === 0 || seconds <= 1) {
    return false;
  }
  const sorted = energy.slice(0, count).sort((a, b) => a - b);
  const size = Math.max(1, Math.floor(count / 5));
  let loud = 0;
  let quiet = 0;
  for (let i = 0; i < size; i++) {
    loud += sorted[count - 1 - i];
    quiet += sorted[i];
  }
  // The analyzer uses -100 dB for exact silence.
  return loud / size > -99 && (loud - quiet) / size < 5;
}

export function recognize(samples, sampleRate, options = {}) {
  validateRate(sampleRate);
  validateSamples(samples);
  const seconds = samples.length / sampleRate;
  if (seconds < 0.05) {
    throw new RecognitionError(
      'empty',
      'Recognition needs at least 50 ms of audio'
    );
  }
  const settings = recognitionSettings(options);
  const level = settings.level === 'auto' ? 'medium' : settings.level;
  const { decoded, input, rate } = decodeRecognitionAudio(
    samples,
    sampleRate,
    settings,
    level
  );
  if (noisyFrames(decoded.frames?.energy, decoded.frames?.count, seconds)) {
    throw new RecognitionError(
      'too-noisy',
      'Audio has less than 5 dB of energy contrast'
    );
  }
  return recognizeDecoded(decoded, input, rate, settings, level, 'batch');
}
