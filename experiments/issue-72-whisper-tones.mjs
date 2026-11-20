/** Measure normalized Mandarin syllable duration at the minimal tier. Unlicense. */
import { synthesize, analyzeFrames, presetHeadConfig } from '../src/index.js';
import { whisperTones } from '../src/recognition/whisper.js';

for (const preset of ['male', 'female']) {
  const options = {
    lang: 'zh',
    head: presetHeadConfig(preset),
    tier: 'minimal',
    seed: 1,
    markup: true,
  };
  const { timeline, plan, samples, sampleRate } = synthesize(
    '[whisper] 妈 麻 马 骂 吗',
    options
  );
  const frames = analyzeFrames(samples, sampleRate);
  const words = timeline.words;
  const meanDuration =
    words.reduce((n, { start, end }) => n + end - start, 0) / words.length;
  for (const word of words) {
    const vowelStart = plan.segments.find(
      (s) => s.kind === 'vowel' && s.start >= word.start - 1e-9
    ).start;
    const costs = Object.entries(
      whisperTones(frames, { ...word, vowelStart, meanDuration })
    ).sort((a, b) => a[1] - b[1]);
    console.log(
      preset,
      word.text,
      (word.end - word.start) / meanDuration,
      costs
    );
  }
}
