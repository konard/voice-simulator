/**
 * The mode check of the roundtrip suite with and without the speaking
 * voice: issue 71 measures effort against a baseline rendered with
 * `options.voice` and gives no effort span without it, so a whole loud
 * sentence can only be heard as `f` when the voice is passed.
 * node experiments/issue-75-mode-voice.mjs [tiers] [langs] [modes]
 * Unlicense.
 */
import { performance } from 'node:perf_hooks';
import { levelForTier, recognize, synthesize } from '../src/index.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [tiers = 'telephone,wideband', langs = 'en,ru,hi,zh', modes = 'f,W'] =
  process.argv.slice(2);
for (const tier of tiers.split(',')) {
  for (const lang of langs.split(',')) {
    for (const mode of modes.split(',')) {
      const text = sentences[lang][0];
      const input =
        mode === 'f'
          ? `<speak><prosody volume="loud">${text}</prosody></speak>`
          : `[whisper]${text}[/whisper]`;
      const spoken = synthesize(input, {
        lang,
        tier,
        head: 'random',
        preset: 'male',
        seed: 1,
        markup: true,
      });
      for (const voice of [undefined, spoken.head]) {
        const start = performance.now();
        const heard = recognize(spoken.samples, spoken.sampleRate, {
          level: levelForTier(tier),
          voice,
        });
        console.log(
          tier,
          lang,
          mode,
          voice ? 'voice' : 'blind',
          `${((performance.now() - start) / 1000).toFixed(1)} s`,
          JSON.stringify(
            heard.modes.map((m) => [
              m.notation,
              m.start.toFixed(2),
              m.end.toFixed(2),
            ])
          ),
          heard.text
        );
      }
    }
  }
}
