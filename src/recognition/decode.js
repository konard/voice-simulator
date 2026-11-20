/** Audio-to-IPA batch and streaming entry points. Unlicense. */
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  resultOf,
} from './decode-pipeline.js';
import { decodeSearch } from './decode-search.js';

export function audioToIpa(samples, sampleRate, options = {}) {
  const settings = decoderSettings(sampleRate, options);
  const analysis = analyzeForDecode(samples, sampleRate, options, settings);
  const { prepared, templates } = prepareIpaDecode(analysis, settings);
  const search = decodeSearch(prepared, settings.language, settings);
  return resultOf(analysis, settings, prepared, templates, search);
}

export { createIpaDecoder } from './decode-stream.js';
