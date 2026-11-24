/**
 * False effort marks: neutral sentences rendered with the male preset and
 * recognised with the speaking voice (as the round-trip mode check does)
 * should give no `p`, `pp`, `f` or `ff` span. Prints every effort span.
 * node experiments/issue-75-neutral-effort.mjs [tiers] [langs] [count]
 * Unlicense.
 */
import { levelForTier, recognize, synthesize } from '../src/index.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [tiers = 'telephone,wideband', langs = 'en,ru,hi,zh', count = '3'] =
  process.argv.slice(2);
const effort = new Set(['pp', 'p', 'f', 'ff']);
let total = 0;
let marked = 0;
for (const tier of tiers.split(',')) {
  for (const lang of langs.split(',')) {
    for (let i = 0; i < Number(count); i++) {
      const spoken = synthesize(sentences[lang][i], {
        lang,
        tier,
        head: 'random',
        preset: 'male',
        seed: 1,
      });
      const heard = recognize(spoken.samples, spoken.sampleRate, {
        level: levelForTier(tier),
        voice: spoken.head,
      });
      const spans = heard.modes.filter((m) => effort.has(m.notation));
      total++;
      marked += Number(spans.length > 0);
      console.log(
        tier,
        lang,
        i + 1,
        JSON.stringify(
          spans.map((m) => [m.notation, m.start.toFixed(2), m.end.toFixed(2)])
        )
      );
    }
  }
}
console.log(`sentences with an effort span: ${marked}/${total}`);
