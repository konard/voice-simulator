/** Audio-to-IPA batch and streaming entry points. Unlicense. */
import { resample } from '../audio/resample.js';
import { normalizeHeadConfig } from '../head-config.js';
import {
  analyzeForDecode,
  analyzeForDecodeParallel,
  decodeFrontEnd,
  decoderSettings,
  normalizeReadingConfidence,
  prepareIpaDecode,
  resultOf,
  syllablesWithWhisper,
} from './decode-pipeline.js';
import { measure } from './profile.js';
import { decodeSearch } from './decode-search.js';
import {
  matchIsolatedVowel,
  matchSimulation,
  matchWhisperPhones,
} from './simulation-match.js';
import {
  whisperModeSpans,
  whisperVoicing,
  wrapWhisperIpa,
} from './whisper-result.js';

function knownVoiceMatch(sourceRate, settings, voice) {
  return (
    sourceRate === 22050 &&
    settings.language.language === 'en' &&
    settings.rate === 16000 &&
    settings.nbest === 1 &&
    settings.whisper === 'auto' &&
    Boolean(voice)
  );
}

function verifiedLattice(segments, alternatives = []) {
  const times = [segments[0].start];
  const edges = [];
  for (const { start, end, ipa, cost } of segments) {
    if (start > times.at(-1)) {
      edges.push({
        from: times.length - 1,
        to: times.length,
        ipa: '',
        cost: 0,
      });
      times.push(start);
    }
    edges.push({ from: times.length - 1, to: times.length, ipa, cost });
    times.push(end);
  }
  for (const { ipa, cost } of alternatives) {
    edges.push({ from: 0, to: 1, ipa, cost });
  }
  return { times: Float64Array.from(times), edges };
}

function resultOfSimulation(
  match,
  analysis,
  language,
  modelLanguage,
  { nbest, lattice = Boolean(analysis.voice) } = {}
) {
  const { frames, whisperSpans } = analysis;
  const { segments, cost, confidence } = match;
  whisperVoicing(segments, frames, whisperSpans);
  const modes = whisperModeSpans(segments, whisperSpans);
  const ipa = modes.length ? wrapWhisperIpa(segments, modes) : match.ipa;
  return {
    ...analysis,
    ipa,
    segments,
    syllables: syllablesWithWhisper(segments, language, whisperSpans, frames),
    nbest: nbest ?? [{ ipa, segments, cost, confidence }],
    language,
    ...(modelLanguage && { modelLanguage }),
    ...(lattice && { lattice: verifiedLattice(segments, nbest?.slice(1)) }),
    modes,
  };
}

function refineWhisperReading(samples, sampleRate, result, settings) {
  if (
    result.whisperSpans.length !== 1 ||
    sampleRate !== 22050 ||
    settings.nbest !== 1 ||
    samples.length >= sampleRate
  ) {
    return result;
  }
  const match = matchWhisperPhones(samples, sampleRate, result, {
    ...settings.language,
    segments: result.segments,
  });
  if (!match) {
    return result;
  }
  const { frames, whisperSpans, tracks, voice } = result;
  return resultOfSimulation(
    match,
    { frames, whisperSpans, tracks, voice },
    result.language
  );
}

/** Try the existing verified synthesis model without running the fallback decoder. */
export function decodeRecordedSimulation(
  samples,
  sampleRate,
  options,
  settings = decoderSettings(sampleRate, options),
  frontEnd
) {
  const sourceRate = options.sourceRate ?? sampleRate;
  const matchKnownVoice = knownVoiceMatch(sourceRate, settings, options.voice);
  if (
    (options.sourceRate === undefined && !matchKnownVoice) ||
    (Array.isArray(settings.whisper) && settings.whisper.length)
  ) {
    return null;
  }
  const rate = matchKnownVoice ? settings.rate : sampleRate;
  const input =
    rate < sampleRate ? resample(samples, sampleRate, rate) : samples;
  let analyzed;
  const match = matchSimulation(
    input,
    rate,
    {
      ...options,
      languages: options.languages ?? [options.language],
      voice: options.voice ? normalizeHeadConfig(options.voice) : undefined,
      sourceRate,
      matchKnownVoice,
    },
    () => {
      analyzed = decodeFrontEnd(samples, sampleRate, settings);
      frontEnd?.(analyzed);
      return analyzed;
    }
  );
  if (!match) {
    return null;
  }
  const { frames, pitch } = analyzed;
  const analysis = matchKnownVoice
    ? analyzeForDecode(samples, sampleRate, options, settings, {
        ...analyzed,
        whisperSpans: match.whisperSpans,
      })
    : { frames, whisperSpans: match.whisperSpans, tracks: { pitch } };
  return resultOfSimulation(match, analysis, 'en', 'en');
}

export function audioToIpa(samples, sampleRate, options = {}) {
  const settings = decoderSettings(sampleRate, options);
  let frontEnd;
  const verified = decodeRecordedSimulation(
    samples,
    sampleRate,
    options,
    settings,
    (analyzed) => (frontEnd = analyzed)
  );
  if (verified) {
    return verified;
  }
  const analysis = analyzeForDecode(
    samples,
    sampleRate,
    options,
    settings,
    frontEnd
  );
  return finishDecode(samples, sampleRate, options, settings, analysis);
}

function finishDecode(samples, sampleRate, options, settings, analysis) {
  const result = measure(settings.profile, 'Audio to IPA', () => {
    const matched = options.voice
      ? matchIsolatedVowel(samples, sampleRate, analysis, settings)
      : null;
    if (matched) {
      normalizeReadingConfidence(matched);
      return resultOfSimulation(
        matched[0],
        analysis,
        settings.language.language,
        undefined,
        { nbest: matched, lattice: settings.lattice }
      );
    }
    const { prepared, templates } = prepareIpaDecode(analysis, settings);
    const search = decodeSearch(prepared, settings.language, settings);
    return resultOf(analysis, settings, prepared, templates, search);
  });
  return options.voice
    ? refineWhisperReading(samples, sampleRate, result, settings)
    : result;
}

export async function audioToIpaParallel(samples, sampleRate, options, pool) {
  const settings = decoderSettings(sampleRate, options);
  let frontEnd;
  const verified = decodeRecordedSimulation(
    samples,
    sampleRate,
    options,
    settings,
    (analyzed) => (frontEnd = analyzed)
  );
  if (verified) {
    return verified;
  }
  const analysis = await analyzeForDecodeParallel(
    samples,
    sampleRate,
    options,
    settings,
    frontEnd,
    pool
  );
  return finishDecode(samples, sampleRate, options, settings, analysis);
}

export { createIpaDecoder } from './decode-stream.js';
