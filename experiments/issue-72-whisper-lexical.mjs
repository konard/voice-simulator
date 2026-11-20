/** Compare lexical readings from the bounded acoustic beam. Unlicense. */
import { audioToIpa, ipaToText } from '../src/index.js';
import { renderWhisper } from './issue-72-whisper-robustness.mjs';

for (const text of ['hello world', 'a big dog', 'she sees five sheep']) {
  const { samples, sampleRate, head } = renderWhisper(`[whisper] ${text}`);
  for (const whisper of [
    'auto',
    [{ start: 0, end: samples.length / sampleRate }],
  ]) {
    const audio = audioToIpa(samples, sampleRate, {
      voice: head,
      language: 'en',
      nbest: 10,
      whisper,
    });
    console.log(
      text,
      whisper === 'auto' ? whisper : 'explicit',
      audio.whisperSpans
    );
    for (const { ipa, cost, segments } of audio.nbest) {
      const { text: heard, alternatives } = ipaToText(
        segments.map((sound) =>
          sound.kind === 'pause' ? { ...sound, ipa: '.' } : sound
        ),
        { language: 'en', nbest: 5 }
      );
      console.log(
        cost.toFixed(2),
        ipa,
        heard,
        alternatives.map(({ text }) => text)
      );
    }
  }
}
