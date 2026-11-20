/** Compare cold startup and phone error with smaller inversion tables. Unlicense. */
import {
  analyzeFrames,
  buildCodebook,
  errorRate,
  findLandmarks,
  invertArticulation,
  trackFormants,
  trackPitch,
} from '../src/index.js';
import {
  decoderSettings,
  prepareIpaDecode,
  resultOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import {
  DECODER_VOICES,
  mean,
  plannedPhones,
  renderDecoderText,
} from '../tests/helpers/decoder-material.js';

const rate = 16000;
const tuning = {
  en: 'Six thin threads hang from the cloth.',
  ru: 'Шёл дождь и дул ветер.',
  hi: 'बच्चे मैदान में खेल रहे हैं।',
  zh: '我们明天去看电影。',
};
for (const [name, voice] of Object.entries(DECODER_VOICES)) {
  const rows = Object.entries(tuning).map(([language, text]) => {
    const { plan, samples } = renderDecoderText(text, voice, rate, language);
    const started = globalThis.performance.now();
    const settings = decoderSettings(rate, { voice, language });
    const frames = analyzeFrames(samples, rate, settings);
    const pitch = trackPitch(frames);
    const formants = trackFormants(frames, {
      pitch,
      vocalTractLength: voice.vocalTractLength,
    });
    const landmarks = findLandmarks(frames);
    const milliseconds = globalThis.performance.now() - started;
    return {
      settings,
      frames,
      pitch,
      formants,
      landmarks,
      milliseconds,
      phones: plannedPhones(plan),
    };
  });
  for (const size of [256, 512, 1024, 5000]) {
    const started = globalThis.performance.now();
    const codebook = buildCodebook(voice, { size, cache: new Map() });
    const startup = globalThis.performance.now() - started;
    const results = rows.map(
      ({
        settings,
        frames,
        pitch,
        formants,
        landmarks,
        phones,
        milliseconds,
      }) => {
        const start = globalThis.performance.now();
        const articulation = invertArticulation(frames, {
          voice,
          codebook,
          pitch,
          formants,
        });
        const analysis = {
          frames,
          voice,
          tracks: { pitch, formants, landmarks, articulation },
        };
        const { templates, prepared } = prepareIpaDecode(analysis, settings);
        const search = decodeSearch(prepared, settings.language, settings);
        const { ipa } = resultOf(
          analysis,
          settings,
          prepared,
          templates,
          search
        );
        const elapsed =
          globalThis.performance.now() - start + milliseconds + startup;
        return {
          rtf: elapsed / ((1000 * frames.sampleCount) / rate),
          per: errorRate(
            phones.map(({ ipa }) => ipa),
            ipa,
            'phone'
          ).rate,
        };
      }
    );
    console.log(
      name,
      size,
      'build ms',
      startup.toFixed(1),
      'mean PER',
      mean(results.map(({ per }) => per)).toFixed(4),
      'mean cold RTF',
      mean(results.map(({ rtf }) => rtf)).toFixed(4)
    );
  }
}
