/** Prepare the golden benchmark's given-language graphs for experiments. Unlicense. */
import { createVoiceFitter } from '../src/index.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
} from '../src/recognition/decode-pipeline.js';
import { loadGolden } from '../tests/helpers/golden.js';

export function* goldenCases(language) {
  const golden = loadGolden(language ? { lang: language } : {});
  for (const speaker of new Set(golden.map((item) => item.speaker.id))) {
    const items = golden.filter((item) => item.speaker.id === speaker);
    const lang = items[0].lang;
    const fitter = createVoiceFitter({ refine: false, language: lang });
    for (const { samples, sampleRate } of items) {
      fitter.update(samples, sampleRate);
    }
    const { head: voice } = fitter.result();
    for (const rate of [16000, 8000]) {
      for (const { id, samples, sampleRate, ipa } of items) {
        const options = { voice, rate, language: lang };
        const settings = decoderSettings(sampleRate, options);
        const analysis = analyzeForDecode(
          samples,
          sampleRate,
          options,
          settings
        );
        yield {
          id,
          lang,
          speaker,
          rate,
          ipa,
          analysis,
          settings,
          ...prepareIpaDecode(analysis, settings),
        };
      }
    }
  }
}
