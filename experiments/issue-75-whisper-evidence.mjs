/** Inspect the detector's evidence on synthetic narrow-band speech. Unlicense. */
import { energyRatio } from '../src/analysis/mode-features.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import { resample } from '../src/audio/resample.js';
import { levelForTier, recognize, synthesize } from '../src/index.js';
import {
  decodeFrontEnd,
  decoderSettings,
} from '../src/recognition/decode-pipeline.js';
import { RECOGNITION_LEVELS } from '../src/recognition/recognizer.js';
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
  let consecutive = 0;
  let sustained = 0;
  for (let i = from; i < to; i++) {
    consecutive =
      pitch.f0[i] > 0 && frames.periodicity[i] >= 0.6 ? consecutive + 1 : 0;
    sustained = Math.max(sustained, consecutive);
  }
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
    sustainedPitch: sustained * frames.hop,
    periodicShare: fraction(from, to, (i) => frames.periodicity[i] >= 0.6),
    planVoicedShare: fraction(
      from,
      to,
      (i) => sampleState(plan, i * frames.hop).voicing > 0.5
    ),
  };
}

const wholeCorpus = process.argv.includes('--corpus');
const modeCases = process.argv.includes('--mode-cases');
const frontEndOnly = process.argv.includes('--front-end-only');
const tier = process.argv.includes('--narrowband') ? 'narrowband' : 'telephone';
const level = levelForTier(tier);
const options = RECOGNITION_LEVELS[level];
const cases = wholeCorpus
  ? Object.entries(sentences).flatMap(([lang, texts]) =>
      texts.map((_, index) => [lang, index])
    )
  : modeCases
    ? Object.keys(sentences).map((lang) => [lang, 0])
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
      tier,
      preset: 'male',
      seed: 1,
      head: 'random',
      markup: true,
    });
    const sampleRate = Math.min(audio.sampleRate, options.rate);
    const samples =
      sampleRate < audio.sampleRate
        ? resample(audio.samples, audio.sampleRate, sampleRate)
        : audio.samples;
    const settings = decoderSettings(sampleRate, options);
    const { frames, pitch, whisperSpans } = decodeFrontEnd(
      samples,
      sampleRate,
      settings
    );
    const details = (spans) =>
      spans.map((span) =>
        evidence({ ...audio, samples, sampleRate }, frames, pitch, span)
      );
    const heard =
      modeCases && mode === 'whisper' && !frontEndOnly
        ? recognize(audio.samples, audio.sampleRate, { level })
        : null;
    console.log(
      JSON.stringify({
        lang,
        tier,
        sampleRate,
        sentence: index + 1,
        mode,
        recognized: details(whisperSpans),
        ...(heard && {
          publicWhispers: heard.modes.filter((m) => m.notation === 'W'),
        }),
        planned: details(audio.plan.modes),
        speechRuns: details(whisperSpeechRuns(frames)),
      })
    );
  }
}
