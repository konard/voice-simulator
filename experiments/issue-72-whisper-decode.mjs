/** Report held-out whispered phone error rates, including voicing confusions. Unlicense. */
import {
  audioToIpa,
  errorRate,
  ipaToText,
  presetHeadConfig,
  synthesize,
} from '../src/index.js';
import {
  plannedPhones,
  DECODE_SENTENCES,
} from '../tests/helpers/decoder-material.js';
import { WHISPER_CUES } from '../src/recognition/data/whisper-cues.js';

const head = presetHeadConfig('male');
const equal = new Map(
  WHISPER_CUES.flatMap(([a, b]) => [
    [a[0], a[0]],
    [b[0], a[0]],
  ])
);
const languages = Object.entries(DECODE_SENTENCES);
if (process.argv.includes('--examples')) {
  languages.splice(
    0,
    languages.length,
    ['en', ['hello world', 'a big dog']],
    ['zh', ['妈 麻 马 骂']]
  );
}
for (const [lang, sentences] of languages) {
  for (const text of sentences.slice(0, 3)) {
    const ref = synthesize(`[whisper] ${text}`, {
      markup: true,
      seed: 1,
      head,
      lang,
      tier: 'minimal',
    });
    const result = audioToIpa(ref.samples, ref.sampleRate, {
      language: lang,
      voice: head,
    });
    const reference = plannedPhones(ref.plan).map(({ ipa }) =>
      ipa.replace(/[˥˦˧˨˩ˈˌ]/gu, '')
    );
    const hypothesis = result.segments
      .filter(({ kind }) => kind !== 'pause')
      .map(({ ipa }) => ipa);
    const per = errorRate(reference.join(' '), hypothesis.join(' '), 'phone');
    const ignoreVoice = (input) =>
      input.map((ipa) => equal.get(ipa) ?? ipa).join(' ');
    const neutral = errorRate(
      ignoreVoice(reference),
      ignoreVoice(hypothesis),
      'phone'
    );
    const words = ipaToText(result.segments, { language: lang });
    console.log(
      JSON.stringify({
        lang,
        text,
        reference: reference.join(' '),
        hypothesis: hypothesis.join(' '),
        per,
        neutral,
        words: words.text,
        spans: result.whisperSpans,
        tones: result.syllables.map((s) => s.tones),
        phones: process.argv.includes('--examples')
          ? result.segments
          : undefined,
      })
    );
  }
}
