/** Inspect the detector's evidence on voiced and whispered 8 kHz speech. */
import { energyRatio } from '../src/analysis/mode-features.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import { synthesize } from '../src/index.js';
import {
  decodeFrontEnd,
  decoderSettings,
} from '../src/recognition/decode-pipeline.js';
import { whisperSpeechRuns } from '../src/recognition/whisper.js';
import { sentences } from '../tests/helpers/roundtrip.js';

function fraction(from, to, predicate) {
  let count = 0;
  for (let frame = from; frame < to; frame++) {
    count += Number(predicate(frame));
  }
  return count / (to - from);
}

function evidence(audio, frames, pitch, span) {
  const { start, end } = span;
  const from = Math.round(start / frames.hop);
  const to = Math.min(frames.count, Math.round(end / frames.hop));
  const { samples, sampleRate, plan } = audio;
  return {
    start,
    end,
    ratio: energyRatio(
      samples,
      sampleRate,
      start * sampleRate,
      end * sampleRate
    ),
    pitchShare: fraction(from, to, (i) => pitch.f0[i] > 0),
    periodicShare: fraction(from, to, (i) => frames.periodicity[i] >= 0.6),
    planVoicedShare: fraction(
      from,
      to,
      (i) => sampleState(plan, i * frames.hop).voicing > 0.5
    ),
  };
}

const wholeCorpus = process.argv.includes('--corpus');
const cases = wholeCorpus
  ? Object.entries(sentences).flatMap(([lang, texts]) =>
      texts.map((_, index) => [lang, index])
    )
  : Object.entries({ en: 17, ru: 1, hi: 1, zh: 1 });

for (const [lang, index] of cases) {
  const text = sentences[lang][index];
  for (const mode of wholeCorpus
    ? ['plain', 'mixed']
    : ['plain', 'whisper', 'mixed']) {
    const input =
      mode === 'plain'
        ? text
        : mode === 'whisper'
          ? `[whisper]${text}[/whisper]`
          : `${text} [whisper]${text}[/whisper]`;
    const audio = synthesize(input, {
      lang,
      tier: 'telephone',
      preset: 'male',
      seed: 1,
      head: 'random',
      markup: true,
    });
    const { samples, sampleRate } = audio;
    const settings = decoderSettings(sampleRate, { hop: 0.01, beam: 8 });
    const { frames, pitch, whisperSpans } = decodeFrontEnd(
      samples,
      sampleRate,
      settings
    );
    const details = (spans) =>
      spans.map((span) => evidence(audio, frames, pitch, span));
    console.log(
      JSON.stringify({
        lang,
        sentence: index + 1,
        mode,
        recognized: details(whisperSpans),
        planned: details(audio.plan.modes),
        speechRuns: details(whisperSpeechRuns(frames)),
      })
    );
  }
}
