/** Check complete whisper renderings against short, unlabeled phone paths. Unlicense. */
import { accentSettings } from '../src/accent/index.js';
import { accentHead } from '../src/accent/head.js';
import { durationTable } from '../src/articulation/durations.js';
import { assignTokenModes } from '../src/articulation/modes.js';
import { buildSegments } from '../src/articulation/plan.js';
import {
  analyzeFrames,
  audioToIpa,
  parseIpa,
  presetHeadConfig,
  synthesize,
} from '../src/index.js';
import { decoderLanguage } from '../src/recognition/decode-model.js';
import { WHISPER_CUES } from '../src/recognition/data/whisper-cues.js';
import { whisperVoicing } from '../src/recognition/whisper-result.js';
import { plannedPhones } from '../tests/helpers/decoder-material.js';

const head = presetHeadConfig('female');
const accent = accentSettings('en');
const accented = accentHead(head, accent);
const timing = {
  rate: accented.speechRate,
  language: 'en',
  head: accented,
  stressLengthening: accented.stressLengthening,
  finalLengthening: accented.finalLengthening,
  pauseLength: accented.pauseLength,
  tunes: accent.prosody.tunes,
  durationTable: durationTable(accent.prosody.tunes),
};
const renderer = { ipa: true, head, tier: 'minimal', seed: 1, engine: 'js' };
const { symbols } = decoderLanguage({ languages: [] });
const consonants = symbols.filter(
  (ipa) => parseIpa(ipa).tokens[0]?.kind === 'consonant'
);

function verify(samples, sampleRate, [first, last]) {
  if (!first || !last) {
    return null;
  }
  for (const consonant of consonants) {
    const ipa = `{W ${first}${consonant}${last} W}`;
    const { tokens, modes } = parseIpa(ipa);
    assignTokenModes(tokens, modes);
    const expected = buildSegments(tokens, timing).at(-1).end;
    if (Math.abs(expected * sampleRate - samples.length) > 1.00001) {
      continue;
    }
    const render = synthesize(ipa, renderer);
    if (
      render.samples.length === samples.length &&
      render.samples.every((sample, i) => sample === samples[i])
    ) {
      return render.plan;
    }
  }
  return null;
}

for (const vowel of process.argv.slice(2)) {
  let matched = 0;
  let correct = 0;
  for (const pair of WHISPER_CUES) {
    for (const [expected, [ipa]] of pair.entries()) {
      const { samples, sampleRate } = synthesize(
        `{W ${vowel}${ipa}${vowel} W}`,
        renderer
      );
      const spans = [{ start: 0, end: samples.length / sampleRate }];
      const { segments } = audioToIpa(samples, sampleRate, {
        voice: head,
        languages: [],
        whisper: spans,
      });
      const vowels = segments.filter(({ kind }) => kind === 'vowel');
      const ends = [vowels[0]?.ipa, vowels.at(-1)?.ipa];
      const recovered = verify(samples, sampleRate, ends);
      let probability;
      if (recovered) {
        matched++;
        const frames = analyzeFrames(samples, sampleRate);
        const timed = plannedPhones(recovered).map((phone, index) => ({
          ...phone,
          kind: index === 1 ? 'consonant' : 'vowel',
        }));
        probability = whisperVoicing(timed, frames, spans)[1].voicing;
        correct += Number(
          probability !== 0.5 && Number(probability > 0.5) === expected
        );
      }
      console.log(
        JSON.stringify({
          vowel,
          ipa,
          ends,
          matched: Boolean(recovered),
          probability,
        })
      );
    }
  }
  console.log(JSON.stringify({ vowel, matched, correct }));
}
