/** Bounded pause-sound fixture probe. Unlicense. */
import {
  synthesize,
  presetHeadConfig,
  recognizeModes,
} from '../../src/index.js';
import { recognizeSounds } from '../../src/recognition/mode-sounds.js';
for (const sound of ['inhale', 'laugh', 'filler']) {
  const audio = synthesize(`⸨${sound}⸩`, {
    ipa: true,
    head: presetHeadConfig('male'),
    tier: 'minimal',
    seed: 1,
    engine: 'js',
  });
  console.log(
    JSON.stringify({
      sound,
      expected: audio.plan.sounds,
      measured: recognizeSounds(audio.samples, audio.sampleRate, []),
      result: recognizeModes(audio.samples, audio.sampleRate, { words: [] }),
    })
  );
}
