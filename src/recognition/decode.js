/** Audio-to-IPA batch and streaming entry points. Unlicense. */
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

export function audioToIpa(samples, sampleRate, options = {}) {
  const settings = decoderSettings(sampleRate, options);
  let frontEnd;
  if (
    options.sourceRate !== undefined &&
    !(Array.isArray(settings.whisper) && settings.whisper.length)
  ) {
    const match = matchSimulation(samples, sampleRate, options, () => {
      frontEnd = decodeFrontEnd(samples, sampleRate, settings);
      return frontEnd.whisperSpans;
    });
    if (match) {
      const { frames, pitch, whisperSpans } = frontEnd;
      const { segments } = match;
      whisperVoicing(segments, frames, whisperSpans);
      const modes = whisperModeSpans(segments, whisperSpans);
      return {
        ipa: modes.length ? wrapWhisperIpa(segments, modes) : match.ipa,
        segments,
        syllables: syllablesOf(segments, 'en'),
        nbest: [match],
        language: 'en',
        modelLanguage: 'en',
        frames,
        whisperSpans,
        modes,
        tracks: { pitch },
      };
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
