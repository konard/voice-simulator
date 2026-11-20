/** Inspect acoustic scores at known phone boundaries. Unlicense. */
import {
  audioToIpa,
  synthesize,
  presetHeadConfig,
  analyzeFrames,
  trackPitch,
} from '../src/index.js';
import { createWhisperScorer } from '../src/recognition/whisper-decode.js';
import { decoderSettings } from '../src/recognition/decode-pipeline.js';
import { plannedPhones } from '../tests/helpers/decoder-material.js';
import { energyRatio } from '../src/analysis/mode-features.js';
import { whisperSpeechRuns } from '../src/recognition/whisper.js';
const head = presetHeadConfig('male');
for (const [lang, text] of [
  ['en', 'hello world'],
  ['en', 'a big dog'],
  ['zh', '妈 麻 马 骂'],
]) {
  const audio = synthesize(`[whisper] ${text}`, {
    tier: 'minimal',
    seed: 1,
    head,
    markup: true,
    lang,
  });
  const options = {
    voice: head,
    language: lang,
    whisper: [{ start: 0.03, end: audio.duration - 0.1 }],
  };
  const frames = analyzeFrames(audio.samples, audio.sampleRate);
  const pitch = trackPitch(frames);
  const settings = decoderSettings(audio.sampleRate, options);
  const templates = settings.language.symbols.map((ipa) => ({
    ipa,
    kind: 'aeiouɑəɪɛʊɔʌɝæɐɚɤɨy'.includes(ipa) ? 'vowel' : 'consonant',
  }));
  const runs = whisperSpeechRuns(frames).map((run) => ({
    ...run,
    ratio: energyRatio(
      audio.samples,
      audio.sampleRate,
      run.start * audio.sampleRate,
      run.end * audio.sampleRate
    ),
    voiced:
      pitch.f0.slice(run.from, run.to).filter(Boolean).length /
      (run.to - run.from),
  }));
  console.log(text, audio.duration, runs);
  const score = createWhisperScorer(
    frames,
    settings.whisper,
    templates,
    settings,
    head
  );
  for (const { ipa, start, end } of plannedPhones(audio.plan)) {
    const { terms } = score(start, end);
    const top = templates
      .map((tpl, i) => [tpl.ipa, terms[3 * i] + 0.65 * terms[3 * i + 1]])
      .sort((a, b) => a[1] - b[1])
      .slice(0, 6);
    console.log(
      ipa,
      start.toFixed(2),
      end.toFixed(2),
      top.map(([ipa, c]) => `${ipa}:${c.toFixed(2)}`).join(' ')
    );
  }
  console.log(audioToIpa(audio.samples, audio.sampleRate, options).ipa);
}
