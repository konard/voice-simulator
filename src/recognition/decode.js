/** Audio-to-IPA batch and streaming entry points. Unlicense. */
import { resample } from '../audio/resample.js';
import { normalizeHeadConfig } from '../head-config.js';
import {
  analyzeForDecode,
  decodeFrontEnd,
  decoderSettings,
  prepareIpaDecode,
  resultOf,
  syllablesOf,
} from './decode-pipeline.js';
import { decodeSearch } from './decode-search.js';
import { matchSimulation } from './simulation-match.js';
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

function verifiedLattice(segments) {
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
  return { times: Float64Array.from(times), edges };
}

function resultOfSimulation(match, analysis, withLattice) {
  const { frames, whisperSpans } = analysis;
  const { segments, cost, confidence } = match;
  whisperVoicing(segments, frames, whisperSpans);
  const modes = whisperModeSpans(segments, whisperSpans);
  const ipa = modes.length ? wrapWhisperIpa(segments, modes) : match.ipa;
  return {
    ...analysis,
    ipa,
    segments,
    syllables: syllablesOf(segments, 'en'),
    nbest: [{ ipa, segments, cost, confidence }],
    language: 'en',
    modelLanguage: 'en',
    ...(withLattice && { lattice: verifiedLattice(segments) }),
    modes,
  };
}

export function audioToIpa(samples, sampleRate, options = {}) {
  const settings = decoderSettings(sampleRate, options);
  let frontEnd;
  const sourceRate = options.sourceRate ?? sampleRate;
  const matchKnownVoice = knownVoiceMatch(sourceRate, settings, options.voice);
  if (
    (options.sourceRate !== undefined || matchKnownVoice) &&
    !(Array.isArray(settings.whisper) && settings.whisper.length)
  ) {
    const rate = matchKnownVoice ? settings.rate : sampleRate;
    const input =
      rate < sampleRate ? resample(samples, sampleRate, rate) : samples;
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
      () => (frontEnd = decodeFrontEnd(samples, sampleRate, settings))
    );
    if (match) {
      const { frames, pitch } = frontEnd;
      const analysis = matchKnownVoice
        ? analyzeForDecode(samples, sampleRate, options, settings, {
            ...frontEnd,
            whisperSpans: match.whisperSpans,
          })
        : { frames, whisperSpans: match.whisperSpans, tracks: { pitch } };
      return resultOfSimulation(match, analysis, matchKnownVoice);
    }
  }
  const analysis = analyzeForDecode(
    samples,
    sampleRate,
    options,
    settings,
    frontEnd
  );
  const { prepared, templates } = prepareIpaDecode(analysis, settings);
  const search = decodeSearch(prepared, settings.language, settings);
  return resultOf(analysis, settings, prepared, templates, search);
}

export { createIpaDecoder } from './decode-stream.js';
