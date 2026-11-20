/** Compare decoded and planned timing for whispered consonants. Unlicense. */
import { presetHeadConfig, synthesize } from '../src/index.js';
import { WHISPER_CUES } from '../src/recognition/data/whisper-cues.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  segmentsOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import { whisperVoicing } from '../src/recognition/whisper-result.js';
import { plannedPhones } from '../tests/helpers/decoder-material.js';

const head = presetHeadConfig('female');
const vowels = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const compareSyllableContexts = process.argv.includes('--syllable-contexts');
const consonantCredits = [0, 0.25, 0.5, 0.75, 1];
const counts = consonantCredits.map(() => ({ correct: 0, extra: 0 }));
for (const vowel of vowels.length ? vowels : ['a']) {
  for (const pair of WHISPER_CUES) {
    for (const [ipa] of pair) {
      const { samples, sampleRate, plan } = synthesize(
        `{W ${vowel}${ipa}${vowel} W}`,
        { ipa: true, head, tier: 'minimal', seed: 1, engine: 'js' }
      );
      const options = {
        voice: head,
        languages: [],
        whisper: [{ start: 0, end: samples.length / sampleRate }],
      };
      const settings = decoderSettings(sampleRate, options);
      if (compareSyllableContexts) {
        settings.vowelContexts = [
          ['m', 'm'],
          ['', 'pa'],
          ['', 'ba'],
          ['ap', ''],
          ['ab', ''],
          ['ap', 'ta'],
          ['ab', 'da'],
        ];
      }
      const analysis = analyzeForDecode(samples, sampleRate, options, settings);
      const { prepared, templates } = prepareIpaDecode(analysis, settings);
      const reference = plannedPhones(plan);
      const middle = (reference[1].start + reference[1].end) / 2;
      const format = ({ ipa, start, end, voicing }) => [
        ipa,
        Math.round(start * 1000),
        Math.round(end * 1000),
        voicing === undefined ? null : Math.round(voicing * 100),
      ];
      const readings = consonantCredits.map((credit, i) => {
        const previousCredit = consonantCredits[i - 1] ?? 0;
        for (const spans of prepared.spans) {
          for (const span of spans.filter(({ whisper }) => whisper)) {
            templates.forEach(({ kind }, unit) => {
              if (kind === 'consonant') {
                span.terms[unit * 3] -= credit - previousCredit;
              }
            });
          }
        }
        const search = decodeSearch(prepared, settings.language, {
          ...settings,
          lattice: false,
        });
        const segments = segmentsOf(
          search.paths[0],
          prepared.times,
          templates,
          settings.language
        );
        whisperVoicing(segments, analysis.frames, analysis.whisperSpans);
        const sound = segments.find(
          ({ start, end }) => start <= middle && middle < end
        );
        const voicing = sound?.voicing;
        counts[i].correct += Number(
          voicing !== undefined &&
            voicing !== 0.5 &&
            voicing > 0.5 === (ipa === pair[1][0])
        );
        counts[i].extra += Math.max(0, segments.length - reference.length);
        return segments.map(format);
      });
      console.log(
        JSON.stringify({ reference: reference.map(format), readings })
      );
    }
  }
}
console.log(JSON.stringify({ consonantCredits, counts }));
