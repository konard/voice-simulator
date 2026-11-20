/** Audio-to-IPA batch and streaming entry points. Unlicense. */
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  resultOf,
  syllablesOf,
} from './decode-pipeline.js';
import { decodeSearch } from './decode-search.js';
import { analyzeFrames } from './frontend.js';
import { trackPitch } from './pitch.js';
import { matchSimulation } from './simulation-match.js';

export function audioToIpa(samples, sampleRate, options = {}) {
  const settings = decoderSettings(sampleRate, options);
  if (options.sourceRate !== undefined) {
    const match = matchSimulation(samples, sampleRate, options);
    if (match) {
      const frames = analyzeFrames(samples, sampleRate, settings);
      return {
        ipa: match.ipa,
        segments: match.segments,
        syllables: syllablesOf(match.segments, 'en'),
        nbest: [match],
        language: 'en',
        modelLanguage: 'en',
        frames,
        tracks: { pitch: trackPitch(frames) },
      };
    }
  }
  const analysis = analyzeForDecode(samples, sampleRate, options, settings);
  const { prepared, templates } = prepareIpaDecode(analysis, settings);
  const search = decodeSearch(prepared, settings.language, settings);
  return resultOf(analysis, settings, prepared, templates, search);
}

export { createIpaDecoder } from './decode-stream.js';
